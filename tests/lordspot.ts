import * as anchor from "@coral-xyz/anchor";
import { LordsPot } from "../target/types/lords_pot";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  getDrawingStatePda,
  getGlobalStatePda,
  getLpDrawingStatePda,
  getLpInfoPda,
  getPerEpochStatePda, getTicketTrackerPda, getTierPayoutsPda, getUserTicketsPda
} from "./utils/seeds_and_ata";

// Load the array from your JSON file
const secretKeyArray = require('../phantom_buffer.json');

// Convert the array into a Uint8Array and generate the Keypair object
const phantomSigner = Keypair.fromSecretKey(new Uint8Array(secretKeyArray));

describe("lordspot", () => {

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.LordsPot as anchor.Program<LordsPot>;
  const wallet = provider.wallet;

  // Variables defined here so they are accessible in all 'it' blocks
  let queue: any;
  let sbProgram: any;



  it("Fetches the current state of the PDA", async () => {
    console.log("🔍 Running Fetch Test...");
    try {
      const tx = await program.methods
          .changeDrawingDuration(new anchor.BN(86400))
          .accounts({
              globalStateAccount: getGlobalStatePda()[0]
          }).signers([phantomSigner])
          .rpc();

        const global_state = await program.account.globalState.fetch(getGlobalStatePda()[0]);
      // const drawingState = await program.account.drawingState.fetch(getDrawingStatePda(1)[0]);
      // const prevEpochPDA = getPerEpochStatePda(0)[0]; // 5FnSgTL7P6fCTzJAjfPwNX7RXwaCXdvhX42k4DQiQ9eb
      // const epcohIdtoLpDrawingState = getLpDrawingStatePda(1)[0]; // DWEwnv4Uw5APWcH4CRKu2xqLmNFu4rcMZiPGvKUHd5kq
      // const lpDrawingState = await program.account.epochIdToLpDrawingState.fetch(getLpDrawingStatePda(0)[0]);
      // const epoch1lpdrawingstate = await program.account.epochIdToLpDrawingState.fetch(epcohIdtoLpDrawingState);
      // console.log(epoch1lpdrawingstate);
      // const userTicketAccount = await program.account.userTickets.fetch(getUserTicketsPda(new PublicKey("41avLJXArHnXf5TjnCfpSsy2XfbQitwNsXiBjzNNpQxo"), 1)[0]);
      // console.log(userTicketAccount.owner, userTicketAccount.tickets, userTicketAccount.claimed);
      // const drawingState = await program.account.epochIdToLpDrawingState.fetch(getLpDrawingStatePda(0)[0]);
      console.log(global_state.drawingDuration);

    } catch (err) {
      console.error("❌ Error fetching PDA. Is it initialized?");
      console.error(err);
      throw err;
    }
  });



  it.only("Deletes the Global State PDA (Universal Close)", async () => {

    console.log("🧹 Wiping Global State PDA...");

    try {

        let ongoing_epoch = 8;

        // # Lpinfo PDA

        let lp_array = [
            "HpAYk14jYpomivS4F7oXySN81sdoPvTaHtFsPgiK2jzf",
        ];
        for (let i = 0; i < lp_array.length; i++) {
            await program.methods
                .universalClose()
                .accounts({
                    admin: phantomSigner.publicKey,
                    targetPda: getLpInfoPda(new PublicKey(lp_array[i]))[0],
                    receiver: wallet.publicKey,
                }).signers([phantomSigner])
                .rpc();
        }


        // # PDA created on succesfull intialization

        const tx1 = await program.methods
            .universalClose()
            .accounts({
                admin: phantomSigner.publicKey,
                targetPda: getGlobalStatePda()[0], // GlobalState
                receiver: wallet.publicKey,
            }).signers([phantomSigner])
            .rpc();

        for (let i = 0; i <= ongoing_epoch; i++){

            if (i != 0) {
                await program.methods
                    .universalClose()
                    .accounts({
                        admin: phantomSigner.publicKey,
                        targetPda: getTicketTrackerPda(i)[0], // TicketTracker - [1, ongoing_epoch]
                        receiver: wallet.publicKey,
                    }).signers([phantomSigner])
                    .rpc();
            }

            if (i != ongoing_epoch) {
                await program.methods
                    .universalClose()
                    .accounts({
                        admin: phantomSigner.publicKey,
                        targetPda: getPerEpochStatePda( i)[0], // PerEpochState - [0, ongoing_epoch)
                        receiver: wallet.publicKey,
                    }).signers([phantomSigner])
                    .rpc();
            }

            if(i != 0 && i != ongoing_epoch) {
                await program.methods
                    .universalClose()
                    .accounts({
                        admin: phantomSigner.publicKey,
                        targetPda: getTierPayoutsPda( i)[0], // TierPayouts - (0, ongoing_epoch)
                        receiver: wallet.publicKey,
                    }).signers([phantomSigner])
                    .rpc();
            }

            await program.methods
                .universalClose()
                .accounts({
                    admin: phantomSigner.publicKey,
                    targetPda: getLpDrawingStatePda( i)[0], // EpochIdToLPDrawingState - [0, ongoing_epoch]
                    receiver: wallet.publicKey,
                }).signers([phantomSigner])
                .rpc();

            await program.methods
                .universalClose()
                .accounts({
                    admin: phantomSigner.publicKey,
                    targetPda: getDrawingStatePda( i)[0], // DrawingState - [0, ongoing_epoch]
                    receiver: wallet.publicKey,
                }).signers([phantomSigner])
                .rpc();
        }


        // # (ticket buyers PDA, epoch wise, which epoch you bought)
        let arr = [
            // ["BFnNt9EKsfZbf7w1GYkWaYHrA5zwbiiAcUZLst4js9Qc", 1] // anant
            // ["BMxDCNpDDepd1TCfV5ECwmsGnYMY7r1j6yGcupPYDFdo", 1], // milan
            // ["9Z88MBc5HfhKM9zDW3Rfv9f8D6AK648hCS33ava6Dfp3", 1], // unnati
            // ["HpAYk14jYpomivS4F7oXySN81sdoPvTaHtFsPgiK2jzf", 1], // me
            // ["4MXuJrbN8X93oncAvTbhn3rDp11xy9DmyVkD7RrszeP5", 1], // ujjawal
            // ["BMxDCNpDDepd1TCfV5ECwmsGnYMY7r1j6yGcupPYDFdo", 3], // milan
            // ["9Z88MBc5HfhKM9zDW3Rfv9f8D6AK648hCS33ava6Dfp3", 3], // unnati
            // ["HpAYk14jYpomivS4F7oXySN81sdoPvTaHtFsPgiK2jzf", 3], // me
            // ["4MXuJrbN8X93oncAvTbhn3rDp11xy9DmyVkD7RrszeP5", 3], // ujjawal,
            // ["B7UDQYFaVDKYqMxAfxsrKN1M1woL2HH9bvc6o2Jd5zea", 3], // priyanka
        ]

        for (let i = 0; i < arr.length; i++) {
            const tx6 = await program.methods
                .universalClose()
                .accounts({
                    admin: phantomSigner.publicKey,
                    targetPda: getUserTicketsPda(new PublicKey(arr[i][0]), new anchor.BN(arr[i][1]))[0],
                    receiver: wallet.publicKey,
                }).signers([phantomSigner])
                .rpc();
        }


    } catch (err) {
        console.error("❌ Error deleting PDA.");
        console.error(err);
        throw err;
      }
    });

  });