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
    getPerEpochStatePda, getTierPayoutsPda
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

// # pda's
    let globalStatePda: anchor.web3.PublicKey;
    let drawingStatePda: anchor.web3.PublicKey;
    let nextDrawingStatePda: anchor.web3.PublicKey;
    let nextTicketTrackerPda: anchor.web3.PublicKey;
    let prevTierPayoutsPda: anchor.web3.PublicKey;

    let globalState: any;
    let drawingState: any;

    before(async () => {
        // 1. Assign to the globally scoped variables (no 'const')
        [globalStatePda] = getGlobalStatePda();
        [drawingStatePda] = getDrawingStatePda(1);

        [nextDrawingStatePda] = getDrawingStatePda(2);
        [nextTicketTrackerPda] = getTicketTrackerPda(2);
        [prevTierPayoutsPda] = getTierPayoutsPda(1);

        globalState = await program.account.globalState.fetch(globalStatePda);
        drawingState = await program.account.drawingState.fetch(drawingStatePda);

        currentEpochId = globalState.currentEpochId.toNumber();
        queue = { pubkey: DEVNET_QUEUE_PUBKEY };
        randomness = new sb.Randomness(sbProgram as any, globalState.switchboardRandomAccount);
    });


    it("2. Successfully commits, reveals the random number, and runs LordsPot", async () => {

        // --- PART 1: COMMIT ---
        const commitIx = await retryCommit(randomness, queue);
        const revealIx = await retryReveal(randomness);

        const commitToRandomNumTx = await program.methods.commit().accounts({
            signer: rngAuthorityKp.publicKey
        }).instruction();

        const commitTx = await sb.asV0Tx({
            connection: provider.connection,
            ixs: [commitIx, commitToRandomNumTx],
            payer: rngAuthorityKp.publicKey,
            signers: [rngAuthorityKp],
        });

        const sig1 = await provider.connection.sendRawTransaction(commitTx.serialize(), { skipPreflight: false });
        const latestBbh1 = await provider.connection.getLatestBlockhash();
        await provider.connection.confirmTransaction({
            signature: sig1,
            ...latestBbh1
        }, "confirmed");

        console.log("Epoch officially locked on-chain!");

        // 🔄 RE-FETCH State before Assertions
        globalState = await program.account.globalState.fetch(globalStatePda);
        drawingState = await program.account.drawingState.fetch(drawingStatePda);

        assert.notEqual(globalState.commitSlot.toNumber(), 0, "commit cannot be 0");
        assert.isTrue(drawingState.lordspotLock, "lock should be true");
        console.log("Commit Slot : ", globalState.commitSlot.toString());

        // --- PART 2: REVEAL & SAVE ---
        const saveToRandomNumTx = await program.methods.save(false)
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

        const sig2 = await provider.connection.sendRawTransaction(revealTx.serialize(), { skipPreflight: false });
        const latestBbh2 = await provider.connection.getLatestBlockhash();
        await provider.connection.confirmTransaction({
            signature: sig2,
            ...latestBbh2
        }, "confirmed");

        console.log("Winning Ticket Saved in Smart Contract");

        // --- PART 3: VERIFY SAVE ---
        // 🔄 RE-FETCH State again!
        drawingState = await program.account.drawingState.fetch(drawingStatePda);

        assert.isTrue(drawingState.lordspotLock, "Drawing state should be locked!");
        assert.notEqual(drawingState.winningTicket.toNumber(), 0, "Winning ticket should not be 0");
        console.log(`RNG Saved! Winning Ticket: ${drawingState.winningTicket.toString()}`);

        // --- PART 4: RUN LORDSPOT (Calculate Tiers & Payouts) ---
        const runTx = await program.methods.runLordspot()
            .accounts({
                signer: rngAuthorityKp.publicKey,
                nextLpDrawingState : getLpDrawingStatePda(currentEpochId + 1)[0],
                // Safe fallback for Epoch 1
                prevPerEpochState: currentEpochId > 1 ? getPerEpochStatePda(currentEpochId - 1)[0] : null,
            })
            .signers([rngAuthorityKp])
            .rpc();

        console.log(`LordsPot successfully run! Tx Sig: ${runTx}`);


        // --- PART 5: FINAL VERIFICATION ---
        // Pass the PDA, not the object!
        const prevDrawingState = await program.account.drawingState.fetch(drawingStatePda);
        assert.isFalse(prevDrawingState.lordspotLock, "Drawing state should be unlocked after run_lordspot!");

        const prevTierPayoutsState = await program.account.tierPayouts.fetch(prevTierPayoutsPda);
        for(let i = 0; i < prevTierPayoutsState.tierPayouts.length; i++) {
            console.log(`Tier ${i}:`, prevTierPayoutsState.tierPayouts[i].toString());
        }

        const nextDrawingState = await program.account.drawingState.fetch(nextDrawingStatePda);
        console.log("Next Prize Pool:", nextDrawingState.prizePool.toString());
        console.log("Next LP Earnings:", nextDrawingState.lpEarnings.toString());
        console.log("Next Drawing Time:", nextDrawingState.drawingTime.toString());
        console.log("Next Lordspot Lock:", nextDrawingState.lordspotLock);
        console.log("Next Special Marble Max:", nextDrawingState.specialMarbleMax);

        console.log(`Tier Payouts calculated and state unlocked successfully!`);
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