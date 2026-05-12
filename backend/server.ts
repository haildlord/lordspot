import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import * as anchor from "@coral-xyz/anchor";
import * as sb from "@switchboard-xyz/on-demand";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { GoogleGenerativeAI } from '@google/generative-ai';

import IDL from "./lords_pot.json";
import {
    getDrawingStatePda,
    getGlobalStatePda,
    getLpDrawingStatePda,
    getPerEpochStatePda,
    getTicketTrackerPda
} from "./seeds_and_ata";

dotenv.config();
console.log(`[SERVER] 🚀 Booting up LordsPot Unified Relayer...`);

const app = express();
app.use(cors());
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

async function retryCommit(randomness: any, queuePubkey: PublicKey, maxRetries: number = 3): Promise<anchor.web3.TransactionInstruction> {
    console.log(`[SWITCHBOARD] 🎲 Preparing Randomness Commit to queue: ${queuePubkey.toBase58()}`);
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[SWITCHBOARD] 🔄 Commit attempt ${attempt}/${maxRetries}...`);
            const ix = await randomness.commitIx(queuePubkey);
            console.log(`[SWITCHBOARD] ✅ Commit Instruction successfully generated.`);
            return ix;
        }
        catch (error: any) {
            console.error(`[SWITCHBOARD WARN] ⚠️ Attempt ${attempt} failed: ${error.message}`);
            if (attempt === maxRetries) throw error;
            await new Promise((r) => setTimeout(r, 2000));
        }
    }
    throw new Error("Commit failed after max retries.");
}

// ==========================================
// [NEW ARCHITECTURE]: STATE LOCKS
// ==========================================
let isCrankInProgress: boolean = false;
let lastCrankTimestamp: number = 0;
// Enforce a strict 60 second cooldown between successful cranks to prevent epoch skipping
const CRANK_COOLDOWN_MS = 60000;

// ==========================================
// 1. CRANK ENDPOINT
// ==========================================
app.post('/crank', async (req: Request, res: Response): Promise<any> => {
    console.log(`\n==================================================`);
    console.log(`[CRANK] 📥 INITIATING CRANK PAYLOAD RECEIVED`);

    // [DEFENSE 1]: The Cooldown Lock
    const timeSinceLastCrank = Date.now() - lastCrankTimestamp;
    if (timeSinceLastCrank < CRANK_COOLDOWN_MS) {
        console.log(`[CRANK GUARD] 🛡️ COOLDOWN ACTIVE. Denying request. Time left: ${((CRANK_COOLDOWN_MS - timeSinceLastCrank) / 1000).toFixed(1)}s`);
        console.log(`==================================================\n`);
        return res.status(200).json({ success: true, message: "Cooldown active." }); // Note: Success=true so frontend doesn't show an error
    }

    // [DEFENSE 2]: The Concurrency Lock
    if (isCrankInProgress) {
        console.log(`[CRANK GUARD] 🛡️ STAMPEDE AVERTED: Crank already running. Rejecting duplicate request.`);
        console.log(`==================================================\n`);
        return res.status(200).json({ success: true, message: "Crank in progress." });
    }

    isCrankInProgress = true;
    console.log(`[CRANK] 🔒 Crank lock acquired. isCrankInProgress = true`);

    try {
        const { programId, sbProgramId, sbQueuePubkey, sbRandomAccount } = req.body;

        const secretKey = process.env.RNG_AUTHORITY_PRIVATE_KEY;
        const heliusapikey = process.env.HELIUS_API_KEY;

        if (!secretKey || !heliusapikey) throw new Error("CRITICAL: Server missing env variables");

        const rngAuthorityKp = anchor.web3.Keypair.fromSecretKey(bs58.decode(secretKey));
        const wallet = new anchor.Wallet(rngAuthorityKp);
        const connection = new anchor.web3.Connection(`https://devnet.helius-rpc.com/?api-key=${heliusapikey}`, "confirmed");
        const provider = new anchor.AnchorProvider(connection, wallet, { preflightCommitment: "confirmed" });
        anchor.setProvider(provider);

        const programPubkey = new PublicKey(programId);
        const customIdl = { ...(IDL as any), address: programPubkey.toBase58() };
        const lordsPotProgram = new anchor.Program(customIdl, provider) as any;
        const sbProgram = await anchor.Program.at(new PublicKey(sbProgramId), provider);
        const randomness = new sb.Randomness(sbProgram as any, new PublicKey(sbRandomAccount));

        console.log(`[STATE] 🔍 Fetching Global State to determine Current Epoch...`);
        const [globalStatePda] = getGlobalStatePda();
        const globalState = await lordsPotProgram.account.globalState.fetch(globalStatePda);
        const currentEpochId: number = globalState.currentEpochId.toNumber();
        console.log(`[STATE] ⚙️ CURRENT EPOCH ON-CHAIN IS: ${currentEpochId}`);

        const [current_drawingStatePda] = getDrawingStatePda(currentEpochId);
        const [nextDrawingStatePda] = getDrawingStatePda(currentEpochId + 1);
        const [nextTicketTrackerPda] = getTicketTrackerPda(currentEpochId + 1);
        const [nextLpDrawingStatePda] = getLpDrawingStatePda(currentEpochId + 1);
        const prevPerEpochStatePda = currentEpochId === 0 ? null : getPerEpochStatePda(currentEpochId - 1)[0];

        let currentDrawingState = await lordsPotProgram.account.drawingState.fetch(current_drawingStatePda);

        // ==========================================
        // PHASE 1: COMMIT
        // ==========================================
        if (!currentDrawingState.lordspotLock) {
            console.log(`\n[PHASE 1] ⏳ Lock is FALSE. Proceeding with Randomness Commit...`);
            try {
                const commitIx = await retryCommit(randomness, new PublicKey(sbQueuePubkey));
                const commitToRandomNumTx = await lordsPotProgram.methods.commit().accounts({
                    signer: rngAuthorityKp.publicKey,
                    globalStateAccount: globalStatePda,
                    switchboardRandomAccount: sbRandomAccount,
                    drawingState: current_drawingStatePda
                }).instruction();

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

                console.log(`[PHASE 1] ✅ Successfully Confirmed! Signature: ${commitSig}`);
                await new Promise((resolve) => setTimeout(resolve, 8000));
            } catch (e: any) {
                const errMsg = e instanceof Error ? e.message : String(e);
                // Gracefully handle Program Error 6048 (Epoch Time Not Reached) without crashing
                if (errMsg.includes("6048")) {
                    console.error(`[PHASE 1 REJECTED] ⚠️ Program rejected commit: Minimum drawing time not reached yet (Custom 6048).`);
                    return res.status(500).json({ success: false, error: "The Lord's Pot is not ready to be drawn yet. Time constraint active." });
                }
                throw new Error(`Phase 1 Failed: ${errMsg}`);
            }
        } else {
            console.log(`\n[PHASE 1] ⏩ Lock is TRUE. Epoch has already committed. Skipping to Phase 2.`);
        }

        currentDrawingState = await lordsPotProgram.account.drawingState.fetch(current_drawingStatePda);

        // ==========================================
        // PHASE 2: REVEAL & SAVE
        // ==========================================
        if (currentDrawingState.winningTicket.toNumber() === 0) {
            console.log(`\n[PHASE 2] ⏳ Winning ticket is 0. Proceeding with Reveal & Save...`);
            try {
                const revealIx = await (randomness as any).revealIx();
                const saveToRandomNumTx = await lordsPotProgram.methods.save(false).accounts({
                    signer: rngAuthorityKp.publicKey,
                    nextDrawingStateAccount: nextDrawingStatePda,
                    nextTicketTracker: nextTicketTrackerPda
                }).instruction();

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
                console.log(`[PHASE 2] ✅ Successfully Confirmed! Winning Ticket Saved. Signature: ${revealSig}`);
            } catch (e: any) {
                const errMsg = e instanceof Error ? e.message : String(e);
                throw new Error(`Phase 2 Failed: ${errMsg}`);
            }
        } else {
            console.log(`\n[PHASE 2] ⏩ Winning ticket > 0. Skipping to Phase 3.`);
        }

        // ==========================================
        // PHASE 3: SETTLE & ROLLOVER
        // ==========================================
        console.log(`\n[PHASE 3] ⏳ Final Phase. Attempting Epoch Settlement & Rollover...`);
        try {
            const rolloverAccounts: any = {
                signer: rngAuthorityKp.publicKey,
                nextDrawingStateAccount: nextDrawingStatePda,
                nextLpDrawingState: nextLpDrawingStatePda
            };
            if (prevPerEpochStatePda) {
                rolloverAccounts.prevPerEpochState = prevPerEpochStatePda;
            }

            const runLordspotIx = await lordsPotProgram.methods.runLordspot().accounts(rolloverAccounts).instruction();
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

            console.log(`[PHASE 3] ✅ SUCCESS! Epoch Settle and Rollover Complete. Signature: ${rolloverSig}`);

            // [CRITICAL FIX]: Lock the server against ANY new cranks for the next 60 seconds.
            lastCrankTimestamp = Date.now();
            console.log(`[CRANK] ⏱️ Epoch Timer Locked for 60 seconds.`);

            return res.status(200).json({ success: true, txSignature: rolloverSig });

        } catch (e: any) {
            const errMsg = e instanceof Error ? e.message : String(e);
            throw new Error(`Phase 3 Failed: ${errMsg}`);
        }

    } catch (error: any) {
        console.error(`\n[CRANK FATAL] ❌ CRITICAL CRANK SERVER ERROR CAUGHT:`, error.message);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        isCrankInProgress = false;
        console.log(`[CRANK] 🔓 Concurrency lock released. isCrankInProgress = false`);
        console.log(`==================================================\n`);
    }
});




// ==========================================
// 2. AI PICK ENDPOINT
// ==========================================
app.post('/api/ai-pick', async (req: Request, res: Response): Promise<any> => {
    // ... [Unchanged, same as before]
    console.log(`\n==================================================`);
    console.log(`[AI] 🧠 INCOMING AI PICK REQUEST`);
    try {
        const { totalPicks, normalMax, specialMax, pastTickets } = req.body;
        if (!totalPicks || !normalMax || !specialMax || !pastTickets || totalPicks > 600) {
            return res.status(400).json({ success: false, error: "Invalid parameters" });
        }

        const pastTicketsContext = pastTickets.length > 0 ? JSON.stringify(pastTickets) : "[]";
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: { responseMimeType: "application/json" }
        });

        const prompt = `Imagine you are the world's foremost researcher in behavioral psychology... 
        [Generate ${totalPicks} tickets. normalMax: ${normalMax}, specialMax: ${specialMax}. Past tickets: ${pastTicketsContext}]
        { "tickets": [ { "normals": [n,n,n,n,n], "bonus": n } ] }`;

        const result = await model.generateContent(prompt);
        const cleanText = result.response.text().replace(/```json/gi, '').replace(/
            ```/g, '').trim();
        const aiData = JSON.parse(cleanText);

        return res.status(200).json({ success: true, tickets: aiData.tickets });

    } catch (error: any) {
        return res.status(500).json({ success: false, error: "The Lord is resting. Try again later." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[SERVER] 🟢 LordsPot Unified Relayer & AI Server is running on port : ${PORT}`);
});