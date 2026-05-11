import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import * as anchor from "@coral-xyz/anchor";
import * as sb from "@switchboard-xyz/on-demand";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import {
    getDrawingStatePda,
    getGlobalStatePda,
    getLpDrawingStatePda,
    getPerEpochStatePda,
    getTicketTrackerPda
} from "./seeds_and_ata";
import { GoogleGenerativeAI } from '@google/generative-ai'

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

import IDL from "./lords_pot.json";

async function retryCommit(randomness: any, queuePubkey: PublicKey, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try { return await randomness.commitIx(queuePubkey); }
        catch (error) {
            if (attempt === maxRetries) throw error;
            await new Promise((r) => setTimeout(r, 2000));
        }
    }
}

let isCrankInProgress = false;

// ==========================================
// 1. CRANK ENDPOINT
// ==========================================
app.post('/crank', async (req, res) => {
    if (isCrankInProgress) {
        console.log("🛡️ STAMPEDE AVERTED: Crank already running.");
        return res.status(200).json({ success: true, message: "Crank in progress." });
    }

    isCrankInProgress = true;

    try {
        const { programId, sbProgramId, sbQueuePubkey, sbRandomAccount } = req.body;
        console.log(`\n==================================================`);
        console.log(`🚀 INITIATING CRANK PAYLOAD RECEIVED`);
        console.log(`==================================================`);

        const secretKey = process.env.RNG_AUTHORITY_PRIVATE_KEY;
        const heliusapikey = process.env.HELIUS_API_KEY;

        if (!secretKey || !heliusapikey) throw new Error("CRITICAL: Server missing env variables");

        const rngAuthorityKp = anchor.web3.Keypair.fromSecretKey(bs58.decode(secretKey));
        const wallet = new anchor.Wallet(rngAuthorityKp);
        const connection = new anchor.web3.Connection(`https://devnet.helius-rpc.com/?api-key=${heliusapikey}`, "confirmed");
        const provider = new anchor.AnchorProvider(connection, wallet, { preflightCommitment: "confirmed" });
        anchor.setProvider(provider);

        const programPubkey = new PublicKey(programId);
        const customIdl = { ...IDL, address: programPubkey.toBase58() };
        const lordsPotProgram = new anchor.Program(customIdl as any, provider) as any;
        const sbProgram = await anchor.Program.at(new PublicKey(sbProgramId), provider);
        const randomness = new sb.Randomness(sbProgram as any, new PublicKey(sbRandomAccount));

        const [globalStatePda] = getGlobalStatePda();
        const globalState = await lordsPotProgram.account.globalState.fetch(globalStatePda);
        const currentEpochId: number = globalState.currentEpochId.toNumber();

        const [current_drawingStatePda] = getDrawingStatePda(currentEpochId);
        const [nextDrawingStatePda] = getDrawingStatePda(currentEpochId + 1);
        const [nextTicketTrackerPda] = getTicketTrackerPda(currentEpochId + 1);
        const [nextLpDrawingStatePda] = getLpDrawingStatePda(currentEpochId + 1);
        const prevPerEpochStatePda = currentEpochId === 0 ? null : getPerEpochStatePda(currentEpochId - 1)[0];

        console.log(`⚙️ CURRENT EPOCH ON-CHAIN: ${currentEpochId}`);

        // 🔍 FETCH LIVE ON-CHAIN STATE BEFORE ACTING
        let currentDrawingState = await lordsPotProgram.account.drawingState.fetch(current_drawingStatePda);

        // ==========================================
        // PHASE 1: COMMIT
        // ==========================================
        if (!currentDrawingState.lordspotLock) {
            console.log("⏳ [PHASE 1] Lock is FALSE. Attempting Commit...");
            try {
                const commitIx = await retryCommit(randomness, new PublicKey(sbQueuePubkey));
                const commitToRandomNumTx = await lordsPotProgram.methods.commit().accounts({
                    signer: rngAuthorityKp.publicKey,
                    globalStateAccount: globalStatePda,
                    switchboardRandomAccount: sbRandomAccount,
                    drawingState: current_drawingStatePda
                }).instruction();

                // 🚀 BUMPED COMPUTE UNITS
                const computeLimitIx = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 });
                const priorityFeeIx = anchor.web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 });
                const { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash();

                const commitMessage = new anchor.web3.TransactionMessage({
                    payerKey: rngAuthorityKp.publicKey, recentBlockhash: blockhash,
                    instructions: [computeLimitIx, priorityFeeIx, commitIx, commitToRandomNumTx]
                }).compileToV0Message();

                const commitTx = new anchor.web3.VersionedTransaction(commitMessage);
                commitTx.sign([rngAuthorityKp]);

                const commitSig = await provider.connection.sendRawTransaction(commitTx.serialize(), { skipPreflight: true });
                const commitConf = await provider.connection.confirmTransaction({ signature: commitSig, blockhash, lastValidBlockHeight }, "confirmed");

                if (commitConf.value.err) throw new Error(JSON.stringify(commitConf.value.err));

                console.log(`✅ [PHASE 1] Successful: ${commitSig}`);
                console.log(`⏱️ Waiting 8 seconds for Switchboard Oracle to resolve...`);
                await new Promise(resolve => setTimeout(resolve, 8000));
            } catch (e: any) {
                const errMsg = e instanceof Error ? e.message : String(e);
                throw new Error(`Phase 1 Failed: ${errMsg}`); // 🛑 ABORT COMPLETELY
            }
        } else {
            console.log("⏩ [PHASE 1] Lock is TRUE. Already committed. Skipping to Phase 2.");
        }

        // 🔍 RE-FETCH STATE BEFORE PHASE 2
        currentDrawingState = await lordsPotProgram.account.drawingState.fetch(current_drawingStatePda);

        // ==========================================
        // PHASE 2: REVEAL & SAVE
        // ==========================================
        if (currentDrawingState.winningTicket.toNumber() === 0) {
            console.log("⏳ [PHASE 2] Winning ticket is 0. Attempting Reveal & Save...");
            try {
                const revealIx = await (randomness as any).revealIx();
                const saveToRandomNumTx = await lordsPotProgram.methods.save(false).accounts({
                    signer: rngAuthorityKp.publicKey,
                    nextDrawingStateAccount: nextDrawingStatePda,
                    nextTicketTracker: nextTicketTrackerPda
                }).instruction();

                // 🚀 MASSIVELY BUMPED COMPUTE UNITS (FROM 250K TO 1 MILLION)
                const computeLimitPhase2Ix = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 });
                const priorityFeePhase2Ix = anchor.web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 });
                const phase2BlockhashInfo = await provider.connection.getLatestBlockhash();

                const revealMessage = new anchor.web3.TransactionMessage({
                    payerKey: rngAuthorityKp.publicKey, recentBlockhash: phase2BlockhashInfo.blockhash,
                    instructions: [computeLimitPhase2Ix, priorityFeePhase2Ix, revealIx, saveToRandomNumTx]
                }).compileToV0Message();

                const revealTx = new anchor.web3.VersionedTransaction(revealMessage);
                revealTx.sign([rngAuthorityKp]);

                const revealSig = await provider.connection.sendRawTransaction(revealTx.serialize(), { skipPreflight: true });
                const revealConf = await provider.connection.confirmTransaction({ signature: revealSig, blockhash: phase2BlockhashInfo.blockhash, lastValidBlockHeight: phase2BlockhashInfo.lastValidBlockHeight }, "confirmed");

                if (revealConf.value.err) throw new Error(JSON.stringify(revealConf.value.err));

                console.log(`✅ [PHASE 2] Successful: ${revealSig}`);
            } catch (e: any) {
                const errMsg = e instanceof Error ? e.message : String(e);
                throw new Error(`Phase 2 Failed: ${errMsg}`); // 🛑 ABORT COMPLETELY! Do not settle without a ticket!
            }
        } else {
            console.log("⏩ [PHASE 2] Winning ticket already drawn. Skipping to Phase 3.");
        }

        // ==========================================
        // PHASE 3: SETTLE & ROLLOVER
        // ==========================================
        console.log("⏳ [PHASE 3] Attempting Settle & Rollover...");
        try {
            const rolloverAccounts: any = { signer: rngAuthorityKp.publicKey, nextLpDrawingState: nextLpDrawingStatePda };
            if (prevPerEpochStatePda) rolloverAccounts.prevPerEpochState = prevPerEpochStatePda;

            const runLordspotIx = await lordsPotProgram.methods.runLordspot().accounts(rolloverAccounts).instruction();

            // 🚀 MASSIVELY BUMPED COMPUTE UNITS (FROM 300K TO 1 MILLION)
            const computeLimitPhase3Ix = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 });
            const priorityFeePhase3Ix = anchor.web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 });
            const phase3BlockhashInfo = await provider.connection.getLatestBlockhash();

            const rolloverMessage = new anchor.web3.TransactionMessage({
                payerKey: rngAuthorityKp.publicKey, recentBlockhash: phase3BlockhashInfo.blockhash,
                instructions: [computeLimitPhase3Ix, priorityFeePhase3Ix, runLordspotIx]
            }).compileToV0Message();

            const rolloverVersionedTx = new anchor.web3.VersionedTransaction(rolloverMessage);
            rolloverVersionedTx.sign([rngAuthorityKp]);

            const rolloverSig = await provider.connection.sendRawTransaction(rolloverVersionedTx.serialize(), { skipPreflight: false });
            const rolloverConf = await provider.connection.confirmTransaction({ signature: rolloverSig, blockhash: phase3BlockhashInfo.blockhash, lastValidBlockHeight: phase3BlockhashInfo.lastValidBlockHeight }, "confirmed");

            if (rolloverConf.value.err) throw new Error(JSON.stringify(rolloverConf.value.err));

            console.log(`✅ [PHASE 3] Successful: Epoch Rolled Over! Sig: ${rolloverSig}`);
            return res.status(200).json({ success: true, txSignature: rolloverSig });
        } catch (e: any) {
            const errMsg = e instanceof Error ? e.message : String(e);
            throw new Error(`Phase 3 Failed: ${errMsg}`);
        }

    } catch (error: any) {
        console.error("❌ CRITICAL CRANK SERVER ERROR:", error.message);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        isCrankInProgress = false;
        console.log("🔓 Crank lock released.");
        console.log(`==================================================\n`);
    }
});

// ==========================================
// 2. AI PICK ENDPOINT
// ==========================================
app.post('/api/ai-pick', async (req, res) => {
    try {
        const { totalPicks, normalMax, specialMax, pastTickets } = req.body;

        // Validation to prevent bad requests
        if (!totalPicks || !normalMax || !specialMax || !pastTickets || totalPicks > 600) {
            return res.status(400).json({ success: false, error: "Invalid parameters" });
        }

        console.log(`Generating ${totalPicks} AI tickets...`);

        // Safely format the past tickets for the prompt
        const pastTicketsContext = pastTickets.length > 0
            ? JSON.stringify(pastTickets)
            : "[] (No tickets have been bought yet in this epoch)";

        // Setup the Model specifically for JSON output
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: {
                responseMimeType: "application/json",
            }
        });

        const prompt = `Imagine you are the world's foremost researcher in behavioral psychology and probability, specializing in how cognitive biases influence human lottery choices.
        I need you to generate exactly ${totalPicks} new lottery tickets for a user.
        
        Here is the historical dataset of tickets already purchased by other players in the current epoch: 
        ${pastTicketsContext} 
        
        Crucial Dataset Context: 
        In this dataset, each array represents a purchased ticket. Indices 0 through 4 are the 'normal' balls selected, and index 5 is the 'bonus' ball.
        
        Your Task:
        Analyze the dataset to identify human psychological patterns, clustering, and overcrowded number combinations. Based on your behavioral research, generate new tickets that strategically avoid these crowd biases to maximize the player's chances of an unshared jackpot.
        
        Strict Constraints for every single ticket:
        1. 'normals': An array of exactly 5 UNIQUE integers between 1 and ${normalMax}. They MUST be sorted in ascending order.
        2. 'bonus': A single integer between 1 and ${specialMax}.
        
        You must reply with a valid JSON object matching this exact schema:
        {
        "tickets": [
        {
            "normals": [number, number, number, number, number],
            "bonus": number
        }
        ]
        }`;

        // Generate and Parse
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        console.log("Raw Gemini Output:", responseText);

        // Strip markdown backticks if Gemini accidentally included them
        const cleanText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
        const aiData = JSON.parse(cleanText);

        // Send it back to the frontend
        return res.status(200).json({
            success: true,
            tickets: aiData.tickets
        });

    } catch (error: any) {
        console.error("AI Pick Error:", error.message);
        return res.status(500).json({ success: false, error: "The Lord is resting. Try again later." });
    }
});

// ==========================================
// 3. START SINGLE SERVER
// ==========================================
// Render provides process.env.PORT automatically. Fallback to 3000 locally.
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`LordsPot Unified Relayer & AI Server running on port : ${PORT}`);
});