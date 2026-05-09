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

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

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

app.post('/api/run-crank', async (req, res) => {
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
        const customIdl = { ...IDL, address: programPubkey.toBase58() };
        const lordsPotProgram = new anchor.Program(customIdl as any, provider) as any;
        const sbProgram = await anchor.Program.at(new PublicKey(sbProgramId), provider);
        const randomness = new sb.Randomness(sbProgram as any, new PublicKey(sbRandomAccount));

        // Get PDAs
        const [globalStatePda] = getGlobalStatePda();
        const globalState = await lordsPotProgram.account.globalState.fetch(globalStatePda);
        const currentEpochId: number = globalState.currentEpochId.toNumber();

        const [current_drawingStatePda] = getDrawingStatePda(currentEpochId);
        const [nextDrawingStatePda] = getDrawingStatePda(currentEpochId + 1);
        const [nextTicketTrackerPda] = getTicketTrackerPda(currentEpochId + 1);
        const [nextLpDrawingStatePda] = getLpDrawingStatePda(currentEpochId + 1);

        const prevPerEpochStatePda = currentEpochId === 0 ? null : getPerEpochStatePda(currentEpochId - 1)[0];

        console.log(`\nCRANK INITIATED FOR EPOCH: ${currentEpochId}`);

        // ==========================================
        // PHASE 1: COMMIT
        // ==========================================
        const commitIx = await retryCommit(randomness, new PublicKey(sbQueuePubkey));
        const commitToRandomNumTx = await lordsPotProgram.methods.commit().accounts({
            signer: rngAuthorityKp.publicKey,
            globalStateAccount: globalStatePda,
            switchboardRandomAccount: sbRandomAccount,
            drawingState: current_drawingStatePda
        }).instruction();

        // 1. MANUALLY SET COMPUTE BUDGET (Bypassing Switchboard's buggy wrapper)
        const computeLimitIx = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 });
        const priorityFeeIx = anchor.web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 });

        // 2. Get the latest blockhash
        const { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash();

        // 3. Build the V0 Transaction Manually
        const commitMessage = new anchor.web3.TransactionMessage({
            payerKey: rngAuthorityKp.publicKey,
            recentBlockhash: blockhash,
            instructions: [computeLimitIx, priorityFeeIx, commitIx, commitToRandomNumTx]
        }).compileToV0Message();

        const commitTx = new anchor.web3.VersionedTransaction(commitMessage);
        commitTx.sign([rngAuthorityKp]);

        // 4. Send and Confirm
        const commitSig = await provider.connection.sendRawTransaction(commitTx.serialize(), { skipPreflight: false });
        await provider.connection.confirmTransaction({
            signature: commitSig,
            blockhash: blockhash,
            lastValidBlockHeight: lastValidBlockHeight
        }, "confirmed");

        console.log(`Phase 1: Commit Successful (UI is now Locked via Webhook)`);
        console.log(`Tx: https://explorer.solana.com/tx/${commitSig}?cluster=devnet`);

        // ==========================================
        // PHASE 2: REVEAL & SAVE (Draw Balls)
        // ==========================================
        const revealIx = await (randomness as any).revealIx();
        const saveToRandomNumTx = await lordsPotProgram.methods.save(true).accounts({ // ! change this to false when deploying
            signer: rngAuthorityKp.publicKey,
            nextDrawingStateAccount: nextDrawingStatePda,
            nextTicketTracker: nextTicketTrackerPda
        }).instruction();

        // 1. MANUALLY SET COMPUTE BUDGET (Bumped to 250k because Fisher-Yates loops vary in cost!)
        const computeLimitPhase2Ix = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 });
        const priorityFeePhase2Ix = anchor.web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 });

        // 2. Get a fresh blockhash (It's been ~10 seconds since Phase 1, always grab a fresh one)
        const phase2BlockhashInfo = await provider.connection.getLatestBlockhash();

        // 3. Build the V0 Transaction Manually
        const revealMessage = new anchor.web3.TransactionMessage({
            payerKey: rngAuthorityKp.publicKey,
            recentBlockhash: phase2BlockhashInfo.blockhash,
            instructions: [computeLimitPhase2Ix, priorityFeePhase2Ix, revealIx, saveToRandomNumTx]
        }).compileToV0Message();

        const revealTx = new anchor.web3.VersionedTransaction(revealMessage);
        revealTx.sign([rngAuthorityKp]);

        // 4. Send and Confirm
        const revealSig = await provider.connection.sendRawTransaction(revealTx.serialize(), { skipPreflight: false });
        await provider.connection.confirmTransaction({
            signature: revealSig,
            blockhash: phase2BlockhashInfo.blockhash,
            lastValidBlockHeight: phase2BlockhashInfo.lastValidBlockHeight
        }, "confirmed");

        console.log(`Phase 2: Reveal & Save Successful (Balls Drawn via Webhook)`);
        console.log(`Tx: https://explorer.solana.com/tx/${revealSig}?cluster=devnet`);

        // ==========================================
        // PHASE 3: SETTLE & ROLLOVER
        // ==========================================

        const rolloverAccounts: any = {
            signer: rngAuthorityKp.publicKey,
            nextLpDrawingState: nextLpDrawingStatePda
        };
        if (prevPerEpochStatePda) rolloverAccounts.prevPerEpochState = prevPerEpochStatePda;

        // 1. Get the raw instruction (do NOT use .rpc() here)
        const runLordspotIx = await lordsPotProgram.methods.runLordspot()
            .accounts(rolloverAccounts)
            .instruction();

        // 2. MANUALLY SET COMPUTE BUDGET (Bumped to 300k to safely cover array iterations)
        const computeLimitPhase3Ix = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 });
        const priorityFeePhase3Ix = anchor.web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 });

        // 3. Get a fresh blockhash
        const phase3BlockhashInfo = await provider.connection.getLatestBlockhash();

        // 4. Build the V0 Transaction Manually
        const rolloverMessage = new anchor.web3.TransactionMessage({
            payerKey: rngAuthorityKp.publicKey,
            recentBlockhash: phase3BlockhashInfo.blockhash,
            instructions: [computeLimitPhase3Ix, priorityFeePhase3Ix, runLordspotIx]
        }).compileToV0Message();

        const rolloverVersionedTx = new anchor.web3.VersionedTransaction(rolloverMessage);
        rolloverVersionedTx.sign([rngAuthorityKp]);

        // 5. Send and Confirm
        const rolloverSig = await provider.connection.sendRawTransaction(rolloverVersionedTx.serialize(), { skipPreflight: false });
        await provider.connection.confirmTransaction({
            signature: rolloverSig,
            blockhash: phase3BlockhashInfo.blockhash,
            lastValidBlockHeight: phase3BlockhashInfo.lastValidBlockHeight
        }, "confirmed");

        console.log(`Phase 3: Epoch Rolled Over! (UI Unlocked via Webhook)`);
        console.log(`Tx: https://explorer.solana.com/tx/${rolloverSig}?cluster=devnet`);

        return res.status(200).json({ success: true, txSignature: rolloverSig });

    } catch (error: any) {
        console.error("Crank Server Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
});


const PORT = 3001;
app.listen(PORT, () => {
    console.log(`LordsPot Secure Relayer running on http://localhost:${PORT}`);
});