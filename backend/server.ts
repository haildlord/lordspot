import express, { Request, Response } from 'express';
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

// ==========================================
// STATE LOCKS (Thundering Herd Protection)
// ==========================================
let isCrankInProgress: boolean = false;
let lastCrankTimestamp: number = 0;
// Enforce a strict 60 second cooldown between successful cranks
const CRANK_COOLDOWN_MS = 60000;

// ==========================================
// 1. CRANK ENDPOINT
// ==========================================
app.post('/crank', async (req: Request, res: Response): Promise<any> => {
    console.log(`\n==================================================`);
    const callerPubkey = req.body.userPubkey || "UNKNOWN_WALLET";
    console.log(`[CRANK] 📥 INITIATING CRANK PAYLOAD RECEIVED FROM: ${callerPubkey}`);

    // [DEFENSE 1]: The Cooldown Lock
    const timeSinceLastCrank = Date.now() - lastCrankTimestamp;
    if (timeSinceLastCrank < CRANK_COOLDOWN_MS) {
        console.log(`[CRANK GUARD] 🛡️ COOLDOWN ACTIVE. Denying request. Time left: ${((CRANK_COOLDOWN_MS - timeSinceLastCrank) / 1000).toFixed(1)}s`);
        console.log(`==================================================\n`);
        return res.status(200).json({ success: true, message: "Cooldown active." });
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
        console.log(`[CRANK] 📦 Payload Data:`);
        console.log(`  -> Program ID: ${programId}`);
        console.log(`  -> SB Program: ${sbProgramId}`);
        console.log(`  -> SB Queue:   ${sbQueuePubkey}`);
        console.log(`  -> SB Random:  ${sbRandomAccount}`);

        const secretKey = process.env.RNG_AUTHORITY_PRIVATE_KEY;
        const heliusapikey = process.env.HELIUS_API_KEY;

        if (!secretKey || !heliusapikey) {
            console.error(`[CRANK FATAL] ❌ Server missing environment variables (RNG Key or Helius API)`);
            throw new Error("CRITICAL: Server missing env variables");
        }

        console.log(`[CRANK] 🔌 Setting up Solana Connection and Anchor Provider...`);
        const rngAuthorityKp = anchor.web3.Keypair.fromSecretKey(bs58.decode(secretKey));
        const wallet = new anchor.Wallet(rngAuthorityKp);
        const connection = new anchor.web3.Connection(`https://devnet.helius-rpc.com/?api-key=${heliusapikey}`, "confirmed");
        const provider = new anchor.AnchorProvider(connection, wallet, { preflightCommitment: "confirmed" });
        anchor.setProvider(provider);
        console.log(`[CRANK] ✅ Provider connected. Authority Wallet: ${rngAuthorityKp.publicKey.toBase58()}`);

        console.log(`[CRANK] 🏗️ Initializing Programs...`);
        const programPubkey = new PublicKey(programId);

        // Safely cast the IDL to bypass strict Anchor type mismatches at compile time
        const customIdl = { ...(IDL as any), address: programPubkey.toBase58() };
        const lordsPotProgram = new anchor.Program(customIdl, provider) as any;

        const sbProgram = await anchor.Program.at(new PublicKey(sbProgramId), provider);
        const randomness = new sb.Randomness(sbProgram as any, new PublicKey(sbRandomAccount));

        console.log(`[STATE] 🔍 Fetching Global State to determine Current Epoch...`);
        const [globalStatePda] = getGlobalStatePda();
        const globalState = await lordsPotProgram.account.globalState.fetch(globalStatePda);
        const currentEpochId: number = globalState.currentEpochId.toNumber();
        console.log(`[STATE] ⚙️ CURRENT EPOCH ON-CHAIN IS: ${currentEpochId}`);

        console.log(`[STATE] 🧮 Deriving related PDAs for Epoch ${currentEpochId} and Epoch ${currentEpochId + 1}...`);
        const [current_drawingStatePda] = getDrawingStatePda(currentEpochId);
        const [nextDrawingStatePda] = getDrawingStatePda(currentEpochId + 1);
        const [nextTicketTrackerPda] = getTicketTrackerPda(currentEpochId + 1);
        const [nextLpDrawingStatePda] = getLpDrawingStatePda(currentEpochId + 1);
        const prevPerEpochStatePda = currentEpochId === 0 ? null : getPerEpochStatePda(currentEpochId - 1)[0];

        console.log(`  -> Current Drawing State PDA: ${current_drawingStatePda.toBase58()}`);
        console.log(`  -> Next Drawing State PDA:    ${nextDrawingStatePda.toBase58()}`);

        console.log(`[STATE] 📡 Fetching Current Drawing State Account...`);
        let currentDrawingState = await lordsPotProgram.account.drawingState.fetch(current_drawingStatePda);
        console.log(`[STATE] 📊 Current Drawing State Lock: ${currentDrawingState.lordspotLock}`);
        console.log(`[STATE] 📊 Current Winning Ticket: ${currentDrawingState.winningTicket.toString()}`);

        // ==========================================
        // PHASE 1: COMMIT
        // ==========================================
        if (!currentDrawingState.lordspotLock) {
            console.log(`\n[PHASE 1] ⏳ Lock is FALSE. Proceeding with Randomness Commit...`);
            try {
                const commitIx = await retryCommit(randomness, new PublicKey(sbQueuePubkey));

                console.log(`[PHASE 1] 📝 Building commit() instruction for LordsPot...`);
                const commitToRandomNumTx = await lordsPotProgram.methods.commit().accounts({
                    signer: rngAuthorityKp.publicKey,
                    globalStateAccount: globalStatePda,
                    switchboardRandomAccount: sbRandomAccount,
                    drawingState: current_drawingStatePda
                }).instruction();

                console.log(`[PHASE 1] ⛽ Setting Compute Budget (200,000 units) and Priority Fees...`);
                const computeLimitIx = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 });
                const priorityFeeIx = anchor.web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 });

                console.log(`[TX] 🔍 Fetching latest blockhash for Phase 1...`);
                const { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash();

                console.log(`[TX] 🏗️ Compiling and signing Versioned Transaction...`);
                const commitMessage = new anchor.web3.TransactionMessage({
                    payerKey: rngAuthorityKp.publicKey, recentBlockhash: blockhash,
                    instructions: [computeLimitIx, priorityFeeIx, commitIx, commitToRandomNumTx]
                }).compileToV0Message();

                const commitTx = new anchor.web3.VersionedTransaction(commitMessage);
                commitTx.sign([rngAuthorityKp]);

                console.log(`[TX] 🚀 Sending Phase 1 Transaction...`);
                const commitSig = await provider.connection.sendRawTransaction(commitTx.serialize(), { skipPreflight: true });
                console.log(`[TX] 🕒 Waiting for confirmation on: ${commitSig}`);

                const commitConf = await provider.connection.confirmTransaction({ signature: commitSig, blockhash, lastValidBlockHeight }, "confirmed");

                if (commitConf.value.err) {
                    console.error(`[TX FATAL] ❌ Phase 1 transaction failed on-chain:`, commitConf.value.err);
                    throw new Error(JSON.stringify(commitConf.value.err));
                }

                console.log(`[PHASE 1] ✅ Phase 1 Successfully Confirmed! Signature: ${commitSig}`);
                console.log(`[PHASE 1] ⏱️ Sleeping for 8 seconds to allow Switchboard Oracle to resolve on-chain...`);
                await new Promise((resolve) => setTimeout(resolve, 8000));
                console.log(`[PHASE 1] ⏰ Wake up! Resuming Crank...`);
            } catch (e: any) {
                const errMsg = e instanceof Error ? e.message : String(e);
                // Gracefully handle Program Error 6048 (Epoch Time Not Reached) without crashing
                if (errMsg.includes("6048")) {
                    console.error(`[PHASE 1 REJECTED] ⚠️ Program rejected commit: Minimum drawing time not reached yet (Custom 6048).`);
                    return res.status(500).json({ success: false, error: "The Lord's Pot is not ready to be drawn yet. Time constraint active." });
                }
                console.error(`[PHASE 1 CRITICAL] 💥 Phase 1 Aborted: ${errMsg}`);
                throw new Error(`Phase 1 Failed: ${errMsg}`);
            }
        } else {
            console.log(`\n[PHASE 1] ⏩ Lock is TRUE. Epoch has already committed. Skipping to Phase 2.`);
        }

        console.log(`[STATE] 📡 Re-fetching Drawing State to check for Oracle fulfillment...`);
        currentDrawingState = await lordsPotProgram.account.drawingState.fetch(current_drawingStatePda);
        console.log(`[STATE] 📊 Re-fetched Winning Ticket: ${currentDrawingState.winningTicket.toString()}`);

        // ==========================================
        // PHASE 2: REVEAL & SAVE
        // ==========================================
        if (currentDrawingState.winningTicket.toNumber() === 0) {
            console.log(`\n[PHASE 2] ⏳ Winning ticket is 0. Proceeding with Reveal & Save...`);
            try {
                console.log(`[SWITCHBOARD] 📝 Generating reveal instruction...`);
                // Explicitly cast randomness to any if TS complains about revealIx not existing on the strict type
                const revealIx = await (randomness as any).revealIx();

                console.log(`[PHASE 2] 📝 Building save() instruction for LordsPot...`);
                const saveToRandomNumTx = await lordsPotProgram.methods.save(false).accounts({
                    signer: rngAuthorityKp.publicKey,
                    nextDrawingStateAccount: nextDrawingStatePda,
                    nextTicketTracker: nextTicketTrackerPda
                }).instruction();

                console.log(`[PHASE 2] ⛽ Setting Massive Compute Budget (1,000,000 units)...`);
                const computeLimitPhase2Ix = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 });
                const priorityFeePhase2Ix = anchor.web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 });

                console.log(`[TX] 🔍 Fetching latest blockhash for Phase 2...`);
                const phase2BlockhashInfo = await provider.connection.getLatestBlockhash();

                console.log(`[TX] 🏗️ Compiling and signing Phase 2 Versioned Transaction...`);
                const revealMessage = new anchor.web3.TransactionMessage({
                    payerKey: rngAuthorityKp.publicKey, recentBlockhash: phase2BlockhashInfo.blockhash,
                    instructions: [computeLimitPhase2Ix, priorityFeePhase2Ix, revealIx, saveToRandomNumTx]
                }).compileToV0Message();

                const revealTx = new anchor.web3.VersionedTransaction(revealMessage);
                revealTx.sign([rngAuthorityKp]);

                console.log(`[TX] 🚀 Sending Phase 2 Transaction...`);
                const revealSig = await provider.connection.sendRawTransaction(revealTx.serialize(), { skipPreflight: true });
                console.log(`[TX] 🕒 Waiting for confirmation on: ${revealSig}`);

                const revealConf = await provider.connection.confirmTransaction({ signature: revealSig, blockhash: phase2BlockhashInfo.blockhash, lastValidBlockHeight: phase2BlockhashInfo.lastValidBlockHeight }, "confirmed");

                if (revealConf.value.err) {
                    console.error(`[TX FATAL] ❌ Phase 2 transaction failed on-chain:`, revealConf.value.err);
                    throw new Error(JSON.stringify(revealConf.value.err));
                }

                console.log(`[PHASE 2] ✅ Phase 2 Successfully Confirmed! Winning Ticket Saved. Signature: ${revealSig}`);
            } catch (e: any) {
                const errMsg = e instanceof Error ? e.message : String(e);
                console.error(`[PHASE 2 CRITICAL] 💥 Phase 2 Aborted: ${errMsg}`);
                throw new Error(`Phase 2 Failed: ${errMsg}`);
            }
        } else {
            console.log(`\n[PHASE 2] ⏩ Winning ticket > 0 (Already Drawn). Skipping to Phase 3.`);
        }

        // ==========================================
        // PHASE 3: SETTLE & ROLLOVER
        // ==========================================
        console.log(`\n[PHASE 3] ⏳ Final Phase. Attempting Epoch Settlement & Rollover...`);
        try {
            console.log(`[PHASE 3] 📝 Packing accounts for runLordspot()...`);
            const rolloverAccounts: any = {
                signer: rngAuthorityKp.publicKey,
                nextDrawingStateAccount: nextDrawingStatePda,
                nextLpDrawingState: nextLpDrawingStatePda
            };
            if (prevPerEpochStatePda) {
                console.log(`[PHASE 3] 🔗 Attaching previous epoch state: ${prevPerEpochStatePda.toBase58()}`);
                rolloverAccounts.prevPerEpochState = prevPerEpochStatePda;
            }

            const runLordspotIx = await lordsPotProgram.methods.runLordspot().accounts(rolloverAccounts).instruction();

            console.log(`[PHASE 3] ⛽ Setting Massive Compute Budget (1,000,000 units)...`);
            const computeLimitPhase3Ix = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 });
            const priorityFeePhase3Ix = anchor.web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 });

            console.log(`[TX] 🔍 Fetching latest blockhash for Phase 3...`);
            const phase3BlockhashInfo = await provider.connection.getLatestBlockhash();

            console.log(`[TX] 🏗️ Compiling and signing Phase 3 Versioned Transaction...`);
            const rolloverMessage = new anchor.web3.TransactionMessage({
                payerKey: rngAuthorityKp.publicKey, recentBlockhash: phase3BlockhashInfo.blockhash,
                instructions: [computeLimitPhase3Ix, priorityFeePhase3Ix, runLordspotIx]
            }).compileToV0Message();

            const rolloverVersionedTx = new anchor.web3.VersionedTransaction(rolloverMessage);
            rolloverVersionedTx.sign([rngAuthorityKp]);

            console.log(`[TX] 🚀 Sending Phase 3 Transaction...`);
            const rolloverSig = await provider.connection.sendRawTransaction(rolloverVersionedTx.serialize(), { skipPreflight: false });
            console.log(`[TX] 🕒 Waiting for confirmation on: ${rolloverSig}`);

            const rolloverConf = await provider.connection.confirmTransaction({ signature: rolloverSig, blockhash: phase3BlockhashInfo.blockhash, lastValidBlockHeight: phase3BlockhashInfo.lastValidBlockHeight }, "confirmed");

            if (rolloverConf.value.err) {
                console.error(`[TX FATAL] ❌ Phase 3 transaction failed on-chain:`, rolloverConf.value.err);
                throw new Error(JSON.stringify(rolloverConf.value.err));
            }

            console.log(`[PHASE 3] ✅ SUCCESS! Epoch Settle and Rollover Complete. Signature: ${rolloverSig}`);

            // [CRITICAL FIX]: Lock the server against ANY new cranks for the next 60 seconds.
            lastCrankTimestamp = Date.now();
            console.log(`[CRANK] ⏱️ Epoch Timer Locked for 60 seconds.`);

            console.log(`[CRANK] 🏁 Entire Crank Process Finished Successfully.`);
            return res.status(200).json({ success: true, txSignature: rolloverSig });

        } catch (e: any) {
            const errMsg = e instanceof Error ? e.message : String(e);
            console.error(`[PHASE 3 CRITICAL] 💥 Phase 3 Aborted: ${errMsg}`);
            throw new Error(`Phase 3 Failed: ${errMsg}`);
        }

    } catch (error: any) {
        console.error(`\n[CRANK FATAL] ❌ CRITICAL CRANK SERVER ERROR CAUGHT:`, error.message);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        isCrankInProgress = false;
        console.log(`[CRANK] 🔓 Crank lock finally released. isCrankInProgress = false`);
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