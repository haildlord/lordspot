import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import {LordsPot} from  "../target/types/lords_pot";
import {loadOrCreateKeypair} from "./utils/utils";
import {
    globalStatePda,
    perEpochState0Pda,
    perEpoch0LPDrawingState,
    epoch1LpDrawingStatePda,
    epoch1DrawingStatePda,
    epoch1TicketTrackerPda,
    getLpInfoPda,
} from "./utils/seeds_and_ata";


describe("After Init", () => {
    const anchorProvider = anchor.AnchorProvider.env();
    anchor.setProvider(anchorProvider);

    // loading IDL of LordsPot
    const lordsPotProgram = anchor.workspace.LordsPot as anchor.Program<LordsPot>;
    let lusdcProgram: anchor.Program;

    // H8Q7CUvPigtSxfd13TKRuFrwdJtc6pJu9BMNhbXF9yAY as getting default wallet provided by typescript
    const defaultWallet = anchorProvider.wallet;

    // create randomAccount and its authority | read if already created
    const rngKp = loadOrCreateKeypair("rng.json");
    const rngAuthorityKp = loadOrCreateKeypair("rng_authority.json");

    const expectedTotal = new anchor.BN(1_100_000).mul(new anchor.BN(1_000_000));

    // STEP 1) state check after init_handler()
    it("initialize state check", async () => {
        const globalState = await lordsPotProgram.account.globalState.fetch(globalStatePda);
        const epochState0 = await lordsPotProgram.account.perEpochState.fetch(perEpochState0Pda);

        assert.equal(globalState.normalMarbleMax, 30, "Normal marble max mismatch");
        assert.equal(globalState.specialBallMin, 5, "Special marble min mismatch");
        assert.equal(globalState.specialBallSoftCap, 65, "Special marble soft cap mismatch");
        assert.equal(globalState.specialBallHardCap, 80, "Special marble hard cap mismatch");
        assert.equal(globalState.drawingDuration.toNumber(), 86400, "drawing duration mismatch");
        assert.equal(globalState.commitSlot.toNumber(), 0, "Commit Slot mismatch");
        assert.equal(globalState.protocolFee.toString(), new anchor.BN(0).toString(), "Wrong Protocol Fee Percentage");
        const expectedFeeThreshold = new anchor.BN(100_000).mul(new anchor.BN(1_000_000));
        assert.equal(globalState.protocolFeeThreshold.toNumber(), expectedFeeThreshold.toNumber(), "Wrong Protocol Fee Threshold");


        // Check large numbers (Anchor returns them as BN objects, so we convert to string to compare)
        assert.equal(
            globalState.poolTotalCap.toString(),
            expectedTotal.toString(),
            "Pool total cap mismatch"
        );

        assert.equal(
            globalState.lpPoolCap.toString(),
            expectedTotal.toString(),
            "Lp Pool cap mismatch"
        );

        assert.equal(
            globalState.ticketPrice.toString(),
            new anchor.BN(1_000_000).toString(),
            "Ticket price mismatch"
        );

        assert.equal(
            globalState.edgePerTicket.toString(),
            new anchor.BN(300_000).toString(),
            "Edge Per Ticket mismatch"
        );

        // Check Pubkeys (Switchboard RNG)
        assert.equal(
            globalState.switchboardRandomAccount.toBase58(),
            rngKp.publicKey.toBase58(),
            "Switchboard RNG pubkey mismatch"
        );

        // Check Per Epoch State
        console.log("Fetching Epoch 0 State...");
        assert.equal(epochState0.epochId.toNumber(), 0, "Epoch ID mismatch in PerEpochState");

        // PRECISE_UNIT is usually 1e12, adjust this expected value to whatever you use
        assert.equal(
            epochState0.sharesPercentage.toString(),
            new anchor.BN(1_000_000_000_000).toString(),
            "Shares percentage should be 100% (PRECISE_UNIT)"
        );

        // PRECISE_UNIT is usually 1e12, adjust this expected value to whatever you use
        assert.equal(
            globalState.lpTargetPercent.toString(),
            new anchor.BN(300_000_000_000).toString(),
            "Shares percentage should be 30%"
        );

        console.log("All state checks passed!");
    })

    // STEP 2) lusdc mint + lp_deposit
    it("lp_deposit state check", async () => {

        // lusdcProgram = await anchor.Program.at(DEVNET_LUSDC_PROGRAM_ID, anchorProvider);
        // let lpMintATA = getUserMintATA(defaultWallet.publicKey);
        //
        // let tx1 = await lusdcProgram.methods.mintMockUsdc(expectedTotal).accounts({
        //     mint: DEVNET_LUSDC_MINT,
        //     destination: lpMintATA,
        //     mintAuthorityPda: lUsdcMintAuthorityPDA,
        //     tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID
        // }).rpc({ commitment: "confirmed" });
        //
        // let tx2 = await lordsPotProgram.methods.lpDeposit(expectedTotal).accounts({
        //     tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        // }).rpc({ commitment: "confirmed" });

        let epochState0LPDrawingState = await lordsPotProgram.account.epochIdToLpDrawingState.fetch(perEpoch0LPDrawingState);
        assert.equal(
            epochState0LPDrawingState.pendingDeposits.toString(),
            expectedTotal.toString(),
            "Pending deposits mismatch"
        );

        let [signerInfoPDA] = getLpInfoPda(defaultWallet.publicKey);

        let lpInfoAccountData = await lordsPotProgram.account.lpInfo.fetch(signerInfoPDA);

        assert.equal(
            lpInfoAccountData.lastDepositInfo.amount.toString(),
            expectedTotal.toString(),
            "Deposited amount is Not full"
        );

        assert.equal(
            lpInfoAccountData.lastDepositInfo.epochId.toNumber(),
            0,
            "Deposited in wrong epoch Id"
        );
    });

    // STEP 3) init_lordspot for buyers & Lp's
    it("init_lordspot state check", async () => {

        // 3. Fetch the updated state accounts
        const globalState = await lordsPotProgram.account.globalState.fetch(globalStatePda);
        const epoch1LpDrawingState = await lordsPotProgram.account.epochIdToLpDrawingState.fetch(epoch1LpDrawingStatePda);
        const epoch1DrawingState = await lordsPotProgram.account.drawingState.fetch(epoch1DrawingStatePda);
        const epoch1TicketTracker = await lordsPotProgram.account.ticketTracker.fetch(epoch1TicketTrackerPda);


        console.log("Fetching Global State Updates...");
        assert.equal(globalState.allowTicketPurchase, true, "Ticket purchase should be allowed");
        assert.equal(globalState.currentEpochId.toNumber(), 1, "Current epoch ID should be incremented to 1");

        console.log("Fetching Epoch 1 LP Drawing State...");
        assert.equal(
            epoch1LpDrawingState.lpPoolTotal.toString(),
            expectedTotal.toString(), // $1.1M
            "LP Pool Total mismatch"
        );
        assert.equal(epoch1LpDrawingState.pendingDeposits.toNumber(), 0, "Pending deposits should be 0");
        assert.equal(epoch1LpDrawingState.pendingWithdrawals.toNumber(), 0, "Pending withdrawals should be 0");

        console.log("Fetching Epoch 1 Drawing State...");
        assert.equal(
            epoch1DrawingState.prizePool.toString(),
            expectedTotal.toString(), // $1.1M
            "Prize Pool mismatch"
        );
        assert.equal(epoch1DrawingState.lpEarnings.toNumber(), 0, "LP earnings should be 0");

        assert.notEqual(
            epoch1DrawingState.drawingTime.toNumber(),
            0,
            "Drawing time mismatch"
        );
        console.log(  epoch1DrawingState.drawingTime.toNumber()); // 1776891238

        assert.equal(epoch1DrawingState.winningTicket.toNumber(),0, "Winning Ticket should be 0");
        assert.equal(epoch1DrawingState.totalTickets.toNumber(), 0, "Total tickets should be 0");
        assert.equal(epoch1DrawingState.specialMarbleMax, 12, "Special marble max calc mismatch");
        assert.equal(epoch1DrawingState.lordspotLock, false, "Lordspot lock should be false");

        console.log("Fetching Epoch 1 Ticket Tracker...");
        assert.equal(epoch1TicketTracker.drawingId.toNumber(), 1, "Ticket tracker drawing ID mismatch");
        assert.equal(epoch1TicketTracker.uniqueTickets.length, 0, "Unique tickets should be empty");
        assert.equal(epoch1TicketTracker.duplicateTickets.length, 0, "Duplicate tickets should be empty");
    });

})