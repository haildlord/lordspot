import * as anchor from "@coral-xyz/anchor";
import { LordsPot } from "../target/types/lords_pot";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
    getDrawingStatePda,
    getGlobalStatePda,
    getLpDrawingStatePda,
    getLpInfoPda,
    getPerEpochStatePda,
    getTicketTrackerPda,
    getTierPayoutsPda,
    getUserTicketsPda
} from "./utils/seeds_and_ata";
import { createClient } from '@supabase/supabase-js';
import dotenv from "dotenv";

// Load the array from your JSON file
const secretKeyArray = require('../phantom_buffer.json');

// Convert the array into a Uint8Array and generate the Keypair object
const phantomSigner = Keypair.fromSecretKey(new Uint8Array(secretKeyArray));

describe("lordspot", () => {

    dotenv.config();
    const supabaseUrl = process.env.SUPABASE_PROJECT_URL;
    console.log("Supabase URL:", supabaseUrl);

    // Using Service Role Key to bypass all RLS protections
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.LordsPot as anchor.Program<LordsPot>;
    const wallet = provider.wallet;

    it("State Checks", async () => {
        console.log("checking the state");
        // console.log("Checking DrawingState : 1");
        // const drawing_state_0 = await program.account.drawingState.fetch(getDrawingStatePda(0)[0]);
        // const drawing_state_1 = await program.account.drawingState.fetch(getDrawingStatePda(1)[0]);
        // const drawing_state_2 = await program.account.drawingState.fetch(getDrawingStatePda(2)[0]);
        // console.log(drawing_state_0);
        // console.log(drawing_state_1);
        // console.log(drawing_state_2);
        const ticket_tracker_3 = await program.account.ticketTracker.fetch(getTicketTrackerPda(4)[0]);
        console.log(ticket_tracker_3);
    })

    it.only("Increase the time to 24hr", async () => {
        console.log("🔍 Running Fetch Test...");
        try {
            const tx = await program.methods
                .changeDrawingDuration(new anchor.BN(86400))
                .accounts({
                    globalStateAccount: getGlobalStatePda()[0]
                }).signers([phantomSigner])
                .rpc();

            const global_state = await program.account.globalState.fetch(getGlobalStatePda()[0]);
            console.log("Drawing Duration:", global_state.drawingDuration.toString());
        } catch (err) {
            console.error("❌ Error fetching PDA. Is it initialized?");
            console.error(err);
            throw err;
        }
    });

    it("Deletes the Global State PDA (Universal Close)", async () => {
        console.log("🧹 Wiping Global State PDA...");

        // Helper function to try closing a PDA, but catch and ignore errors if it fails
        const safeClose = async (targetPda: anchor.web3.PublicKey, label: string) => {
            try {
                console.log(`🗑️ Attempting to close: ${label}`);
                await program.methods
                    .universalClose()
                    .accounts({
                        admin: phantomSigner.publicKey,
                        targetPda: targetPda,
                        receiver: wallet.publicKey,
                    })
                    .signers([phantomSigner])
                    .rpc();
                console.log(`✅ Successfully closed: ${label}`);
            } catch (e: any) {
                console.log(`⚠️ Skipped: ${label} (May not exist or already closed).`);
            }
        };

        let subase_current_epoch = await supabase.from("global_config").select("current_epoch_id");
        let ongoing_epoch = 10 // subase_current_epoch.data?.[0]?.current_epoch_id || 0;

        try {
            // ==========================================
            // 1. GLOBAL STATE & GLOBAL CONFIG
            // ==========================================
            await safeClose(getGlobalStatePda()[0], "GlobalState (On-Chain)");

            // SUPABASE GLOBAL CONFIG WIPE
            console.log("🗑️ Cleaning up global_config in Supabase...");
            const { error: globalConfigError } = await supabase
                .from("global_config")
                .delete()
                .eq("id", 1);

            if (globalConfigError) {
                console.error("❌ Supabase Global Config Deletion Error:", globalConfigError);
            } else {
                console.log("✅ Successfully deleted global_config from Supabase!");
            }

            // ==========================================
            // 2. EPOCH-SPECIFIC PDAs
            // ==========================================
            for (let i = 0; i <= Number(ongoing_epoch); i++) {
                if (i !== 0) {
                    await safeClose(getTicketTrackerPda(i)[0], `TicketTracker | Epoch: ${i}`);
                }
                if (i !== Number(ongoing_epoch)) {
                    await safeClose(getPerEpochStatePda(i)[0], `PerEpochState | Epoch: ${i}`);
                }
                if (i !== 0 && i !== Number(ongoing_epoch)) {
                    await safeClose(getTierPayoutsPda(i)[0], `TierPayouts | Epoch: ${i}`);
                }

                await safeClose(getLpDrawingStatePda(i)[0], `EpochIdToLPDrawingState | Epoch: ${i}`);
                await safeClose(getDrawingStatePda(i)[0], `DrawingState | Epoch: ${i}`);
            }

            // ==========================================
            // 3. TICKET BUYERS PDAs & SUPABASE
            // ==========================================
            try {
                let arr: [string, number][] = [];
                const { data } = await supabase.from("ticket_purchases").select("*");

                if (data) {
                    for (let i = 0; i < data.length; i++) {
                        const { epoch_id, buyer_address } = data[i];
                        const alreadyExists = arr.some(element => element[0] === buyer_address && element[1] === epoch_id);
                        if (!alreadyExists) {
                            arr.push([buyer_address, epoch_id]);
                        }
                    }
                }

                console.log(`\n🔍 Found ${arr.length} unique UserTickets PDAs to close.`);
                for (let i = 0; i < arr.length; i++) {
                    const userPubkey = new PublicKey(arr[i][0]);
                    const epochId = new anchor.BN(arr[i][1]);
                    await safeClose(getUserTicketsPda(userPubkey, epochId)[0], `UserTickets | Buyer: ${arr[i][0]} | Epoch: ${arr[i][1]}`);
                }

                // SUPABASE TICKET WIPE
                const allIdsToDelete = data ? data.map(row => row.id) : [];

                if (allIdsToDelete.length > 0) {
                    const { error: deleteError } = await supabase
                        .from("ticket_purchases")
                        .delete()
                        .in("id", allIdsToDelete);

                    if (deleteError) {
                        console.error("❌ Supabase Tickets Deletion Error:", deleteError);
                    } else {
                        console.log(`✅ Successfully deleted ${allIdsToDelete.length} tickets from Supabase!`);
                    }
                } else {
                    console.log("No tickets to delete.");
                }

            } catch (error) {
                console.log("❌ Fatal error during ticket deletion:", error);
            }

            // ==========================================
            // 4. LP INFO PDAs & SUPABASE LOGS
            // ==========================================
            try {
                const { data: lpData, error: lpFetchError } = await supabase
                    .from("lp_activity_logs")
                    .select("id, user_address");

                if (lpFetchError) throw lpFetchError;

                let uniqueLpAddresses: string[] = [];
                const seenLpAddresses = new Set();
                const allLpIdsToDelete: any[] = [];

                if (lpData) {
                    lpData.forEach(row => {
                        allLpIdsToDelete.push(row.id);

                        if (!seenLpAddresses.has(row.user_address)) {
                            seenLpAddresses.add(row.user_address);
                            uniqueLpAddresses.push(row.user_address);
                        }
                    });
                }

                console.log(`\n🔍 Found ${uniqueLpAddresses.length} unique LpInfo PDAs to close.`);

                for (let i = 0; i < uniqueLpAddresses.length; i++) {
                    const address = uniqueLpAddresses[i];
                    await safeClose(getLpInfoPda(new PublicKey(address))[0], `LpInfo | Wallet: ${address}`);
                }

                // SUPABASE LP WIPE
                console.log("\n🗑️ Cleaning up lp_activity_logs in Supabase...");

                if (allLpIdsToDelete.length > 0) {
                    const { error: deleteLpError } = await supabase
                        .from("lp_activity_logs")
                        .delete()
                        .in("id", allLpIdsToDelete);

                    if (deleteLpError) {
                        console.error("❌ Supabase LP Deletion Error:", deleteLpError);
                    } else {
                        console.log(`✅ Successfully deleted ${allLpIdsToDelete.length} LP logs from Supabase!`);
                    }
                } else {
                    console.log("No LP logs to delete in Supabase.");
                }

            } catch (error) {
                console.error("❌ Fatal error during LP Info deletion process:", error);
            }

            // ==========================================
            // 5. EPOCH PRIZE TIERS & EPOCHS (SUPABASE)
            // ==========================================
            try {
                console.log("\n🗑️ Cleaning up epoch_prize_tiers and epochs in Supabase...");

                // Step A: Delete epoch_prize_tiers FIRST to clear foreign key constraints
                const { error: tiersError } = await supabase
                    .from("epoch_prize_tiers")
                    .delete()
                    .not("epoch_id", "is", null);

                if (tiersError) {
                    console.error("❌ Supabase Epoch Prize Tiers Deletion Error:", tiersError);
                } else {
                    console.log("✅ Successfully wiped epoch_prize_tiers from Supabase!");
                }

                // Step B: Delete epochs SECOND
                const { error: epochsError } = await supabase
                    .from("epochs")
                    .delete()
                    .not("epoch_id", "is", null);

                if (epochsError) {
                    console.error("❌ Supabase Epochs Deletion Error:", epochsError);
                } else {
                    console.log("✅ Successfully wiped epochs from Supabase!");
                }

            } catch (error) {
                console.error("❌ Fatal error during Epochs deletion process:", error);
            }

        } catch (err) {
            console.error("❌ A catastrophic error occurred that escaped the inner loops.");
            console.error(err);
            throw err;
        }
    });
});