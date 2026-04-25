import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert, expect } from "chai";
import * as sb from "@switchboard-xyz/on-demand";
import { LordsPot } from "../target/types/lords_pot";
import { loadOrCreateKeypair } from "./utils/utils";
import {
    DEVNET_SB_PROGRAM_ID,
    DEVNET_QUEUE_PUBKEY,
    getGlobalStatePda,
    getDrawingStatePda,
    getTicketTrackerPda,
    getLpDrawingStatePda,
    getPerEpochStatePda
} from "./utils/seeds_and_ata";

// --- Switchboard Retry Helpers ---
async function retryCommit(randomness: sb.Randomness, queue: any, maxRetries = 3): Promise<anchor.web3.TransactionInstruction> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await randomness.commitIx(queue.pubkey);
        } catch (error) {
            if (attempt === maxRetries) throw error;
            await new Promise((r) => setTimeout(r, 2000));
        }
    }
    throw new Error("All commit attempts failed");
}

async function retryReveal(randomness: sb.Randomness, maxRetries = 5): Promise<anchor.web3.TransactionInstruction> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await randomness.revealIx();
        } catch (error) {
            if (attempt === maxRetries) throw error;
            await new Promise((r) => setTimeout(r, 2000));
        }
    }
    throw new Error("All reveal attempts failed");
}

describe("Phase 3: Run Lordspot (Gas Relayer Architecture)", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.LordsPot as Program<LordsPot>;

    // ==========================================
    // 👑 LOAD THE RELAYER / AUTHORITY KEYPAIR
    // ==========================================
    // This wallet will pay for and sign ALL transactions
    const rngAuthorityKp = loadOrCreateKeypair("rng_authority.json");

    let queue: any;
    let sbProgram: any;
    let randomness: sb.Randomness;
    let currentEpochId: number;

    before(async () => {
        const [globalStatePda] = getGlobalStatePda();
        const globalState = await program.account.globalState.fetch(globalStatePda);
        currentEpochId = globalState.currentEpochId.toNumber();

        // Local fork bypass for Switchboard
        sbProgram = await anchor.Program.at(DEVNET_SB_PROGRAM_ID, provider);
        queue = { pubkey: DEVNET_QUEUE_PUBKEY };
        randomness = new sb.Randomness(sbProgram as any, globalState.switchboardRandomAccount);
    });

    // # this below test 1 will only pass if the runJackpot is called before the 1 day, for correct logic it will always fail -- hence commenting it
    // it("1. Fails to commit because drawing duration hasn't passed", async () => {
    //     try {
    //         const commitIx = await retryCommit(randomness, queue);
    //
    //         const commitToRandomNumTx = await program.methods.commit().accounts({
    //             signer: rngAuthorityKp.publicKey
    //         }).instruction();
    //
    //         const commitTx = await sb.asV0Tx({
    //             connection: provider.connection,
    //             ixs: [commitIx, commitToRandomNumTx],
    //             payer: rngAuthorityKp.publicKey,
    //             signers: [rngAuthorityKp],
    //             computeUnitPrice: 75_000,
    //             computeUnitLimitMultiple: 1.6,
    //         });
    //
    //         // This forces Solana to simulate the tx, realize it violates your time-lock, and throw an error immediately!
    //         await provider.connection.sendRawTransaction(commitTx.serialize(), { skipPreflight: false });
    //
    //         // If the code reaches this line, the transaction SUCCEEDED (which means your time-lock is broken).
    //         assert.fail("SECURITY BREACH: Allowed execution before time lock expired!");
    //
    //     } catch (err) {
    //         const msg = err.message || err.toString();
    //
    //         if (msg.includes("SECURITY BREACH")) {
    //             throw err;
    //         }
    //
    //         // If it was a Solana error, check to make sure it was the EXACT right error.
    //         expect(msg).to.include("CameTooEarlyToRunLordsPot");
    //         console.log("Time-lock holds. Execution successfully rejected.");
    //     }
    // });

    it("2. Successfully commits and reveals the random number", async () => {
        // --- PART 1: COMMIT ---
        const commitIx = await retryCommit(randomness, queue);
        const commitToRandomNumTx = await program.methods.commit().accounts({
            signer: rngAuthorityKp.publicKey
        }).instruction();

        const commitTx = await sb.asV0Tx({
            connection: provider.connection,
            ixs: [commitIx, commitToRandomNumTx],
            payer: rngAuthorityKp.publicKey,
            signers: [rngAuthorityKp],
        });

        await provider.connection.sendRawTransaction(commitTx.serialize(), { skipPreflight: false });
        console.log("      🔒 Epoch successfully locked!");

        // --- PART 2: THE WAIT ---
        console.log("      🎲 Waiting 5s for Oracle to generate randomness...");
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // --- PART 3: REVEAL ---
        const [nextDrawingStatePda] = getDrawingStatePda(currentEpochId + 1);
        const [nextTicketTrackerPda] = getTicketTrackerPda(currentEpochId + 1);

        // 👇 YOUR NGROK URL
        const NGROK_URL = "https://cornflake-blade-dwelling.ngrok-free.dev";
        console.log(`      📡 Using Tunnel: ${NGROK_URL}`);

        // 👇 We use 'as any' to bypass the mismatched TypeScript definition
        const revealIx = await (randomness as any).revealIx({
            rpc: NGROK_URL
        });

        const saveToRandomNumTx = await program.methods.save(true)
            .accounts({
                signer: rngAuthorityKp.publicKey,
                nextDrawingStateAccount: nextDrawingStatePda,
                nextTicketTracker: nextTicketTrackerPda,
            })
            .instruction();

        const revealTx = await sb.asV0Tx({
            connection: provider.connection,
            ixs: [revealIx, saveToRandomNumTx],
            payer: rngAuthorityKp.publicKey,
            signers: [rngAuthorityKp],
        });

        const sig = await provider.connection.sendRawTransaction(revealTx.serialize(), { skipPreflight: false });
        await provider.connection.confirmTransaction(sig, "confirmed");

        // --- PART 4: VERIFY ---
        const [drawingStatePda] = getDrawingStatePda(currentEpochId);
        const drawingState = await program.account.drawingState.fetch(drawingStatePda);

        assert.isTrue(drawingState.lordspotLock, "Drawing state should be locked!");
        assert.equal(drawingState.winningTicket.toString(), "4398046511166", "Winning ticket was not forced!");
        console.log(`      🎉 RNG Saved! Winning Ticket: ${drawingState.winningTicket.toString()}`);
    });

    // it("4. Saves the random number (Reveals RNG)", async () => {
    //     console.log("      🎲 Waiting 3s for Oracle to generate randomness...");
    //     await new Promise((resolve) => setTimeout(resolve, 3000));
    //
    //     const [nextDrawingStatePda] = getDrawingStatePda(currentEpochId + 1);
    //     const [nextTicketTrackerPda] = getTicketTrackerPda(currentEpochId + 1);
    //
    //     const revealIx = await retryReveal(randomness);
    //
    //     // TRUE = Hackathon test mode
    //     const saveToRandomNumTx = await program.methods.save(true)
    //         .accounts({
    //             signer: rngAuthorityKp.publicKey,
    //             nextDrawingStateAccount: nextDrawingStatePda,
    //             nextTicketTracker: nextTicketTrackerPda,
    //         })
    //         .instruction();
    //
    //     const revealTx = await sb.asV0Tx({
    //         connection: provider.connection,
    //         ixs: [revealIx, saveToRandomNumTx],
    //         payer: rngAuthorityKp.publicKey, // Gas paid by the relayer
    //         signers: [rngAuthorityKp],       // Signed by the relayer
    //         computeUnitPrice: 75_000,
    //         computeUnitLimitMultiple: 1.3,
    //     });
    //
    //     const sig = await provider.connection.sendRawTransaction(revealTx.serialize(), { skipPreflight: true });
    //
    //     const latestBlockhash = await provider.connection.getLatestBlockhash();
    //     await provider.connection.confirmTransaction({ signature: sig, ...latestBlockhash }, "confirmed");
    //
    //     const [drawingStatePda] = getDrawingStatePda(currentEpochId);
    //     const drawingState = await program.account.drawingState.fetch(drawingStatePda);
    //     assert.equal(drawingState.winningTicket.toString(), "4398046511166", "Winning ticket was not forced correctly!");
    //     console.log(`      🎉 RNG Saved! Winning Ticket: ${drawingState.winningTicket.toString()}`);
    // });
    //
    // it("5. [FUTURE] Runs Lordspot, calculates payouts, and rolls epoch over", async () => {
    //     const [nextLpDrawingStatePda] = getLpDrawingStatePda(currentEpochId + 1);
    //     const prevPerEpochStatePda = currentEpochId === 0
    //         ? null
    //         : getPerEpochStatePda(currentEpochId - 1)[0];
    //
    //     // Override Anchor's default provider wallet and explicitly tell it to use rngAuthorityKp
    //     const tx = await program.methods.runLordspot()
    //         .accounts({
    //             signer: rngAuthorityKp.publicKey,
    //             nextLpDrawingState: nextLpDrawingStatePda,
    //             prevPerEpochState: prevPerEpochStatePda,
    //         })
    //         .signers([rngAuthorityKp]) // Anchor needs this array to inject the signature
    //         .rpc({ commitment: "confirmed" });
    //
    //     const [globalStatePda] = getGlobalStatePda();
    //     const globalStateAfter = await program.account.globalState.fetch(globalStatePda);
    //
    //     const [drawingStatePda] = getDrawingStatePda(currentEpochId);
    //     const oldDrawingStateAfter = await program.account.drawingState.fetch(drawingStatePda);
    //
    //     assert.equal(globalStateAfter.currentEpochId.toNumber(), currentEpochId + 1, "Epoch ID did not increment!");
    //     assert.isFalse(oldDrawingStateAfter.lordspotLock, "Old drawing state should be unlocked for claims!");
    //
    //     console.log(`      ✅ Rolled over safely to Epoch ${globalStateAfter.currentEpochId.toNumber()}!`);
    // });
});