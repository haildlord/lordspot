    import * as anchor from "@coral-xyz/anchor";
    import { Program } from "@coral-xyz/anchor";
    import { assert } from "chai";
    import { getAccount } from "@solana/spl-token";
    import { LordsPot } from "../target/types/lords_pot";
    import { LordsMockUsdc } from "../target/types/lords_mock_usdc";

    import {
        DEVNET_LUSDC_MINT,
        getGlobalStatePda,
        getDrawingStatePda,
        getTicketTrackerPda,
        getUserTicketsPda,
        getProtocolUsdcVaultAta,
        getUserMintATA
    } from "./utils/seeds_and_ata";

    describe("buy_ticket_handler", () => {
        const provider = anchor.AnchorProvider.env();
        anchor.setProvider(provider);

        const program = anchor.workspace.LordsPot as Program<LordsPot>;
        const lusdcProgram = anchor.workspace.LordsMockUsdc as Program<LordsMockUsdc>;

        // The buyer wallet
        const buyer = anchor.web3.Keypair.generate();

        // ========================================================================
        // SETUP STATIC ACCOUNTS
        // ========================================================================
        const buyerUsdcAta = getUserMintATA(buyer.publicKey);
        const vaultAta = getProtocolUsdcVaultAta();

        const buyTicketAccounts = {
            signer: buyer.publicKey,
            buyersUsdcAccount: buyerUsdcAta,
            protocolUsdcVault: vaultAta,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        };

        before(async () => {
            console.log(`\nInitializing Buyer: ${buyer.publicKey.toBase58()}`);

            // 1. Airdrop & Confirm
            const sig = await provider.connection.requestAirdrop(buyer.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
            const latestBlockhash = await provider.connection.getLatestBlockhash();
            await provider.connection.confirmTransaction({
                signature: sig,
                blockhash: latestBlockhash.blockhash,
                lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
            }, "confirmed");

            // 2. Mint Mock USDC and Auto-Initialize ATA
            await lusdcProgram.methods
                .mintMockUsdc(new anchor.BN(1_000_000_000))
                .accounts({
                    mint: DEVNET_LUSDC_MINT,
                    destination: buyerUsdcAta,
                    signer: buyer.publicKey,
                    tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
                    associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                } as any)
                .signers([buyer])
                .rpc({ commitment: "confirmed" });
        });

        // User buys 3 unique tickets
        it("1. Successfully buys 3 multiple unique tickets", async () => {
            // 1. FETCH THE REAL CURRENT EPOCH FIRST
            const [globalStatePda] = getGlobalStatePda();
            const globalState = await program.account.globalState.fetch(globalStatePda);
            const currentEpoch = globalState.currentEpochId;

            console.log(`Current Protocol Epoch is: ${currentEpoch.toString()}`);

            // 2. DERIVE PDAs DYNAMICALLY
            const [userTicketsPda] = getUserTicketsPda(buyer.publicKey, currentEpoch);
            const [ticketTrackerPda] = getTicketTrackerPda(currentEpoch);
            const [drawingStatePda] = getDrawingStatePda(currentEpoch);

            const tickets = [
                { normalMarbles: Buffer.from([1, 5, 12, 20, 30]), specialMarble: 8 },
                { normalMarbles: Buffer.from([1, 5, 12, 20, 30]), specialMarble: 12 },
                { normalMarbles: Buffer.from([1, 5, 12, 20, 30]), specialMarble: 10 },
            ];

            // 3. CAPTURE "BEFORE" STATE FOR RELATIVE ASSERTIONS
            const vaultBefore = await getAccount(provider.connection, vaultAta);
            const drawingStateBefore = await program.account.drawingState.fetch(drawingStatePda);
            const trackerBefore = await program.account.ticketTracker.fetch(ticketTrackerPda);

            // 4. EXECUTE TRANSACTION
            await program.methods
                .buyTickets(tickets)
                .accounts(buyTicketAccounts)
                .signers([buyer])
                .rpc({ commitment: "confirmed" });

            // 5. --- ASSERTIONS ---
            const userState = await program.account.userTickets.fetch(userTicketsPda);
            assert.equal(userState.owner.toBase58(), buyer.publicKey.toBase58(), "Owner mismatch");
            assert.equal(userState.tickets.length, 3, "User should have exactly 3 tickets in their account");

            for(let i = 0; i < userState.tickets.length; i++) {
                assert.equal(userState.claimed[i], false, `Ticket at index ${i} should not be claimed`);
            }

            const trackerAfter = await program.account.ticketTracker.fetch(ticketTrackerPda);
            assert.equal(
                trackerAfter.uniqueTickets.length,
                trackerBefore.uniqueTickets.length + 3,
                "Should add 3 to the unique bucket"
            );
            assert.equal(
                trackerAfter.duplicateTickets.length,
                trackerBefore.duplicateTickets.length,
                "Should NOT change duplicate bucket"
            );

            const vaultAfter = await getAccount(provider.connection, vaultAta);
            const expectedVaultAmount = vaultBefore.amount + BigInt(3000000);
            assert.equal(vaultAfter.amount.toString(), expectedVaultAmount.toString(), "USDC Vault did not receive exactly 3 USDC");

            const drawingStateAfter = await program.account.drawingState.fetch(drawingStatePda);
            const expectedTotalTickets = drawingStateBefore.totalTickets.toNumber() + 3;
            assert.equal(drawingStateAfter.totalTickets.toNumber(), expectedTotalTickets, "Total tickets in drawing state should increment by 3");

            assert.equal(drawingStateAfter.prizePool.toNumber(), 1100000000000, "No duplicate Tickets were bought");
        });

        it("2. Handles Duplicate Tickets correctly (increases prize pool)", async () => {
            const [globalStatePda] = getGlobalStatePda();
            const globalState = await program.account.globalState.fetch(globalStatePda);
            const currentEpoch = globalState.currentEpochId;

            const [ticketTrackerPda] = getTicketTrackerPda(currentEpoch);
            const [drawingStatePda] = getDrawingStatePda(currentEpoch);

            // This is the EXACT same ticket from Test 1.
            const tickets = [
                { normalMarbles: Buffer.from([1, 5, 12, 20, 30]), specialMarble: 8 },
            ];

            // --- CAPTURE BEFORE STATE ---
            const trackerBefore = await program.account.ticketTracker.fetch(ticketTrackerPda);
            const drawingBefore = await program.account.drawingState.fetch(drawingStatePda);
            const vaultBefore = await getAccount(provider.connection, vaultAta);

            await program.methods
                .buyTickets(tickets)
                .accounts(buyTicketAccounts)
                .signers([buyer])
                .rpc({ commitment: "confirmed" });

            // --- ASSERTIONS ---
            const trackerAfter = await program.account.ticketTracker.fetch(ticketTrackerPda);

            // Unique bucket should NOT change size
            assert.equal(
                trackerAfter.uniqueTickets.length,
                trackerBefore.uniqueTickets.length,
                "Unique bucket should not increase"
            );

            // Duplicate bucket SHOULD increase by 1
            assert.equal(
                trackerAfter.duplicateTickets.length,
                trackerBefore.duplicateTickets.length + 1,
                "Duplicate bucket should increment by 1"
            );

            const drawingAfter = await program.account.drawingState.fetch(drawingStatePda);
            assert.isTrue(
                drawingAfter.prizePool.gt(drawingBefore.prizePool),
                "Prize pool must increase when a duplicate ticket is bought!"
            );

            const vaultAfter = await getAccount(provider.connection, vaultAta);
            const expectedVaultAmount = vaultBefore.amount + BigInt(1_000_000); // 1 USDC for 1 ticket
            assert.equal(vaultAfter.amount.toString(), expectedVaultAmount.toString(), "Vault should only take 1 USDC");
        });

        it("3. Rejects a ticket containing duplicate marbles", async () => {
            const badTickets = [
                {
                    normalMarbles: Buffer.from([5, 5, 12, 20, 30]), // The number 5 is repeated!
                    specialMarble: 8
                },
            ];

            try {
                await program.methods
                    .buyTickets(badTickets)
                    .accounts(buyTicketAccounts)
                    .signers([buyer])
                    .rpc({ commitment: "confirmed" });

                // If the transaction succeeds, the test fails!
                assert.fail("Transaction should have failed but it succeeded!");
            } catch (err) {
                // Anchor errors usually contain the name of the custom error you wrote in Rust.
                // Change "DuplicateMarble" to whatever your actual #[error_code] is named!
                assert.include(err.message, "DuplicateMarble", "Did not throw the correct duplicate marble error");
            }
        });

        it("4. Rejects a ticket with marbles outside the allowed range", async () => {
            const outOfBoundsTickets = [
                {
                    normalMarbles: Buffer.from([1, 5, 12, 20, 99]), // 99 is too high!
                    specialMarble: 8
                },
            ];

            try {
                await program.methods
                    .buyTickets(outOfBoundsTickets)
                    .accounts(buyTicketAccounts)
                    .signers([buyer])
                    .rpc({ commitment: "confirmed" });

                assert.fail("Transaction should have failed but it succeeded!");
            } catch (err) {
                // Change "InvalidMarble" to your actual Rust error name
                assert.include(err.message, "InvalidMarble", "Did not throw the out of bounds error");
            }
        });

        it("5. Rejects a purchase if the user has insufficient USDC", async () => {
            const brokeUser = anchor.web3.Keypair.generate();
            const brokeUserAta = getUserMintATA(brokeUser.publicKey);

            // Airdrop SOL so they can pay transaction fees, but DO NOT mint them USDC!
            const sig = await provider.connection.requestAirdrop(brokeUser.publicKey, anchor.web3.LAMPORTS_PER_SOL);
            const latestBlockhash = await provider.connection.getLatestBlockhash();
            await provider.connection.confirmTransaction({
                signature: sig,
                blockhash: latestBlockhash.blockhash,
                lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
            }, "confirmed");

            const brokeAccounts = {
                ...buyTicketAccounts,
                signer: brokeUser.publicKey,
                buyersUsdcAccount: brokeUserAta, // They don't have this initialized or funded
            };

            const tickets = [
                { normalMarbles: Buffer.from([2, 4, 6, 8, 10]), specialMarble: 5 },
            ];

            try {
                await program.methods
                    .buyTickets(tickets)
                    .accounts(brokeAccounts)
                    .signers([brokeUser])
                    .rpc({ commitment: "confirmed" });

                assert.fail("Transaction should have failed but it succeeded!");
            } catch (err) {
                // This will likely fail at the Token Program level before your Rust code even executes
                // It will throw either AccountNotInitialized or InsufficientFunds
                const errorString = err.toString();
                const hasExpectedError = errorString.includes("AccountNotInitialized") || errorString.includes("InsufficientFunds");
                assert.isTrue(hasExpectedError, `Unexpected error thrown: ${errorString}`);
            }
        });

        // ========================================================================
        // ADVANCED EDGE CASES & EXPLOIT ATTEMPTS
        // ========================================================================

        it("6. Rejects tickets with too few or too many normal marbles", async () => {
            const tooFewTickets = [{ normalMarbles: Buffer.from([1, 5, 12, 20]), specialMarble: 8 }]; // Only 4
            const tooManyTickets = [{ normalMarbles: Buffer.from([1, 5, 12, 20, 30, 31]), specialMarble: 8 }]; // 6 marbles

            // Test Too Few
            try {
                await program.methods.buyTickets(tooFewTickets).accounts(buyTicketAccounts).signers([buyer]).rpc();
                assert.fail("Should have failed with too few marbles");
            } catch (err) {
                assert.include(err.message, "InvalidNormalsCount", "Failed to catch too few marbles");
            }

            // Test Too Many
            try {
                await program.methods.buyTickets(tooManyTickets).accounts(buyTicketAccounts).signers([buyer]).rpc();
                assert.fail("Should have failed with too many marbles");
            } catch (err) {
                assert.include(err.message, "InvalidNormalsCount", "Failed to catch too many marbles");
            }
        });

        it("7. Rejects batch purchases outside allowed limits (0 or > 20)", async () => {
            const emptyBatch = [];

            // Create an array of 21 valid tickets
            const massiveBatch = Array(21).fill({ normalMarbles: Buffer.from([1, 2, 3, 4, 5]), specialMarble: 1 });

            // Test Empty Array
            try {
                await program.methods.buyTickets(emptyBatch).accounts(buyTicketAccounts).signers([buyer]).rpc();
                assert.fail("Should have failed with 0 tickets");
            } catch (err) {
                assert.include(err.message, "NoTicketsProvided", "Failed to catch empty array");
            }

            // Test > 20 Array
            try {
                await program.methods.buyTickets(massiveBatch).accounts(buyTicketAccounts).signers([buyer]).rpc();
                assert.fail("Should have failed with > 20 tickets");
            } catch (err) {
                assert.include(err.message, "TooManyTickets", "Failed to catch massive batch");
            }
        });

        it("8. Rejects Special Marbles that are 0 or out of bounds", async () => {
            const zeroSpecial = [{ normalMarbles: Buffer.from([1, 5, 12, 20, 30]), specialMarble: 0 }];
            const highSpecial = [{ normalMarbles: Buffer.from([1, 5, 12, 20, 30]), specialMarble: 255 }]; // Assuming 255 is > max

            try {
                await program.methods.buyTickets(zeroSpecial).accounts(buyTicketAccounts).signers([buyer]).rpc();
                assert.fail("Should have failed with special marble = 0");
            } catch (err) {
                assert.include(err.message, "InvalidSpecialMarble", "Failed to catch special marble 0");
            }

            try {
                await program.methods.buyTickets(highSpecial).accounts(buyTicketAccounts).signers([buyer]).rpc();
                assert.fail("Should have failed with special marble out of bounds");
            } catch (err) {
                assert.include(err.message, "InvalidSpecialMarble", "Failed to catch high special marble");
            }
        });

        it("9. Rejects normal marbles that are not sorted in strictly ascending order", async () => {
            const unsortedTicket = [
                // These are valid numbers, just out of order!
                { normalMarbles: Buffer.from([30, 20, 12, 5, 1]), specialMarble: 8 }
            ];

            try {
                await program.methods.buyTickets(unsortedTicket).accounts(buyTicketAccounts).signers([buyer]).rpc();
                assert.fail("SECURITY FLAW: Contract accepted unsorted marbles, risking hash duplication bypass!");
            } catch (err) {
                // Update "UnsortedMarbles" to whatever you name the error in Rust
                assert.include(err.message, "UnsortedMarbles", "Did not throw the unsorted error");
            }
        });

        it("10. State Integrity: Appends correctly for returning users (Second Purchase)", async () => {
            // The buyer already bought 4 tickets in previous tests (3 in Test 1, 1 duplicate in Test 2)
            // We are checking if the `user_tickets` array appends safely without overwriting.

            const [globalStatePda] = getGlobalStatePda();
            const globalState = await program.account.globalState.fetch(globalStatePda);
            const [userTicketsPda] = getUserTicketsPda(buyer.publicKey, globalState.currentEpochId);

            const stateBefore = await program.account.userTickets.fetch(userTicketsPda);
            const previousTicketCount = stateBefore.tickets.length;

            const newPurchase = [
                { normalMarbles: Buffer.from([2, 4, 6, 8, 10]), specialMarble: 1 }
            ];

            await program.methods.buyTickets(newPurchase).accounts(buyTicketAccounts).signers([buyer]).rpc({ commitment: "confirmed" });

            const stateAfter = await program.account.userTickets.fetch(userTicketsPda);

            assert.equal(
                stateAfter.tickets.length,
                previousTicketCount + 1,
                "Failed to append new ticket to existing user account"
            );
            assert.equal(stateAfter.claimed.length, stateAfter.tickets.length, "Claimed array length mismatch");
        });

        it("11. State Integrity: Validates LP Earnings Math", async () => {
            const [globalStatePda] = getGlobalStatePda();
            const globalState = await program.account.globalState.fetch(globalStatePda);
            const [drawingStatePda] = getDrawingStatePda(globalState.currentEpochId);

            const drawingBefore = await program.account.drawingState.fetch(drawingStatePda);

            // Buy 2 tickets
            const tickets = [
                { normalMarbles: Buffer.from([11, 12, 13, 14, 15]), specialMarble: 2 },
                { normalMarbles: Buffer.from([16, 17, 18, 19, 20]), specialMarble: 3 },
            ];

            await program.methods.buyTickets(tickets).accounts(buyTicketAccounts).signers([buyer]).rpc({ commitment: "confirmed" });

            const drawingAfter = await program.account.drawingState.fetch(drawingStatePda);

            // total_cost = 2 * ticket_price. LP Earnings should increase by EXACTLY this amount.
            const expectedCost = globalState.ticketPrice.muln(2);
            const expectedLpEarnings = drawingBefore.lpEarnings.add(expectedCost);

            assert.isTrue(
                drawingAfter.lpEarnings.eq(expectedLpEarnings),
                `LP Earnings mismatch. Expected ${expectedLpEarnings.toString()}, got ${drawingAfter.lpEarnings.toString()}`
            );
        });

        it("12. Intra-Batch Duplicates: Correctly splits identical tickets in the same array", async () => {
            const [globalStatePda] = getGlobalStatePda();
            const globalState = await program.account.globalState.fetch(globalStatePda);
            const [ticketTrackerPda] = getTicketTrackerPda(globalState.currentEpochId);

            const trackerBefore = await program.account.ticketTracker.fetch(ticketTrackerPda);

            // A user submits the EXACT same numbers twice in one transaction
            const batchWithInternalDuplicate = [
                { normalMarbles: Buffer.from([3, 6, 9, 12, 15]), specialMarble: 7 },
                { normalMarbles: Buffer.from([3, 6, 9, 12, 15]), specialMarble: 7 },
            ];

            await program.methods
                .buyTickets(batchWithInternalDuplicate)
                .accounts(buyTicketAccounts)
                .signers([buyer])
                .rpc({ commitment: "confirmed" });

            const trackerAfter = await program.account.ticketTracker.fetch(ticketTrackerPda);

            // The first ticket should go to Unique, the second MUST go to Duplicate
            assert.equal(
                trackerAfter.uniqueTickets.length,
                trackerBefore.uniqueTickets.length + 1,
                "Only the first ticket should be unique"
            );
            assert.equal(
                trackerAfter.duplicateTickets.length,
                trackerBefore.duplicateTickets.length + 1,
                "The second ticket should be routed to the duplicate bucket"
            );
        });

        it("13. Capacity Test: Safely blocks user when exceeding max limit (50 tickets)", async () => {
            // We will try to buy 3 batches of 20 (60 tickets).
            // We EXPECT the contract to stop us before we finish!
            let hitLimitError = false;

            for (let i = 0; i < 3; i++) {
                let massiveBatch = [];
                for(let j = 0; j < 20; j++) {
                    massiveBatch.push({
                        // i and j ensure strict ascending order to pass validation
                        normalMarbles: Buffer.from([1, 2, 3, 4, 5 + i + j]),
                        specialMarble: 1
                    });
                }

                try {
                    await program.methods
                        .buyTickets(massiveBatch)
                        .accounts(buyTicketAccounts)
                        .signers([buyer])
                        .rpc({ commitment: "confirmed" });
                } catch (err) {
                    // We expect it to fail on Batch 3!
                    if (err.message.includes("UserEpochLimitReached")) {
                        hitLimitError = true;
                        break; // Stop the loop, the contract successfully defended itself.
                    } else {
                        // If it fails for any OTHER reason, that's a real bug.
                        assert.fail(`Failed with unexpected error: ${err.message}`);
                    }
                }
            }

            assert.isTrue(
                hitLimitError,
                "SECURITY FLAW: User was able to buy more than 50 tickets without triggering the limit!"
            );

            // Let's also verify their account stopped near the limit
            const [globalStatePda] = getGlobalStatePda();
            const globalState = await program.account.globalState.fetch(globalStatePda);
            const [userTicketsPda] = getUserTicketsPda(buyer.publicKey, globalState.currentEpochId);

            const userState = await program.account.userTickets.fetch(userTicketsPda);
            assert.isTrue(
                userState.tickets.length <= 50,
                `User somehow has ${userState.tickets.length} tickets, which violates the 50 ticket limit!`
            );
        });
    });