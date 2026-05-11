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
      console.log(global_state.lpPoolCap);

    } catch (err) {
      console.error("❌ Error fetching PDA. Is it initialized?");
      console.error(err);
      throw err;
    }
  });

  it.only("Deletes the Global State PDA (Universal Close)", async () => {
    console.log("🧹 Wiping Global State PDA...");

    try {

      // const tx9 = await program.methods
      //     .universalClose()
      //     .accounts({
      //       admin: phantomSigner.publicKey,
      //       targetPda: getDrawingStatePda(0)[0],     // DrawingState-0
      //       receiver: wallet.publicKey,
      //     }).signers([phantomSigner])
      //     .rpc();
      //
      // const tx1 = await program.methods
      //     .universalClose()
      //     .accounts({
      //       admin: phantomSigner.publicKey,
      //       targetPda: getGlobalStatePda()[0],     // GlobalState
      //       receiver: wallet.publicKey,
      //     }).signers([phantomSigner])
      //     .rpc();
      //
      //
      // const tx2 = await program.methods
      //     .universalClose()
      //     .accounts({
      //       admin: phantomSigner.publicKey,
      //       targetPda: getLpDrawingStatePda(0)[0],     // EpochIdToLPDrawingState-0
      //       receiver: wallet.publicKey,
      //     }).signers([phantomSigner])
      //     .rpc();
      //
      // const tx3 = await program.methods
      //     .universalClose()
      //     .accounts({
      //       admin: phantomSigner.publicKey,
      //       targetPda: getPerEpochStatePda(0)[0], // PerEpochState - 0
      //       receiver: wallet.publicKey,
      //     }).signers([phantomSigner])
      //     .rpc();
      //
      // const tx5 = await program.methods
      //     .universalClose()
      //     .accounts({
      //       admin: phantomSigner.publicKey,
      //       targetPda: getLpInfoPda(new PublicKey("HpAYk14jYpomivS4F7oXySN81sdoPvTaHtFsPgiK2jzf"))[0], // HpAYk14jYpomivS4F7oXySN81sdoPvTaHtFsPgiK2jzf, H8Q7CUvPigtSxfd13TKRuFrwdJtc6pJu9BMNhbXF9yAY
      //       receiver: wallet.publicKey,
      //     }).signers([phantomSigner])
      //     .rpc();
      //
      // const tx6 = await program.methods
      //     .universalClose()
      //     .accounts({
      //       admin: phantomSigner.publicKey,
      //       targetPda: getLpDrawingStatePda(1)[0], // EpochIdToLPDrawingState-1
      //       receiver: wallet.publicKey,
      //     }).signers([phantomSigner])
      //     .rpc();
      //
      // const tx7 = await program.methods
      //     .universalClose()
      //     .accounts({
      //       admin: phantomSigner.publicKey,
      //       targetPda: getDrawingStatePda(1)[0],     // DrawingState-1
      //       receiver: wallet.publicKey,
      //     }).signers([phantomSigner])
      //     .rpc();
      //
      // const tx8 = await program.methods
      //     .universalClose()
      //     .accounts({
      //       admin: phantomSigner.publicKey,
      //       targetPda: getTicketTrackerPda( 1)[0], // TicketTracker-1
      //       receiver: wallet.publicKey,
      //     }).signers([phantomSigner])
      //     .rpc();
      //
      //
         // # commit - save - runLordspot


        let till_epoch_id = 4;
        for (let i = 2; i <= till_epoch_id; i++){

            // const tx10 = await program.methods
            //     .universalClose()
            //     .accounts({
            //         admin: phantomSigner.publicKey,
            //         targetPda: getTierPayoutsPda( i-1)[0], // TierPayouts
            //         receiver: wallet.publicKey,
            //     }).signers([phantomSigner])
            //     .rpc();

            // const tx11 = await program.methods
            //     .universalClose()
            //     .accounts({
            //         admin: phantomSigner.publicKey,
            //         targetPda: getPerEpochStatePda( i-1)[0], // PerEpochState
            //         receiver: wallet.publicKey,
            //     }).signers([phantomSigner])
            //     .rpc();
            //
            // const tx12 = await program.methods
            //     .universalClose()
            //     .accounts({
            //         admin: phantomSigner.publicKey,
            //         targetPda: getDrawingStatePda( i)[0], // DrawingState
            //         receiver: wallet.publicKey,
            //     }).signers([phantomSigner])
            //     .rpc();
            //
            // const tx15 = await program.methods
            //     .universalClose()
            //     .accounts({
            //         admin: phantomSigner.publicKey,
            //         targetPda: getTierPayoutsPda( i)[0], // TierPayouts
            //         receiver: wallet.publicKey,
            //     }).signers([phantomSigner])
            //     .rpc();
            //
            // const tx16 = await program.methods
            //     .universalClose()
            //     .accounts({
            //         admin: phantomSigner.publicKey,
            //         targetPda: getPerEpochStatePda( i)[0], // PerEpochState
            //         receiver: wallet.publicKey,
            //     }).signers([phantomSigner])
            //     .rpc();
            //
            // const tx14 = await program.methods
            //     .universalClose()
            //     .accounts({
            //         admin: phantomSigner.publicKey,
            //         targetPda: getLpDrawingStatePda( i)[0], // EpochIdToLPDrawingState
            //         receiver: wallet.publicKey,
            //     }).signers([phantomSigner])
            //     .rpc();
            //
            // const tx18 = await program.methods
            //     .universalClose()
            //     .accounts({
            //         admin: phantomSigner.publicKey,
            //         targetPda: getTicketTrackerPda( i)[0], // TicketTracker
            //         receiver: wallet.publicKey,
            //     }).signers([phantomSigner])
            //     .rpc();

        }


        let arr = [
            // "BFnNt9EKsfZbf7w1GYkWaYHrA5zwbiiAcUZLst4js9Qc", // anant
            // "BMxDCNpDDepd1TCfV5ECwmsGnYMY7r1j6yGcupPYDFdo", // milan
            // "9Z88MBc5HfhKM9zDW3Rfv9f8D6AK648hCS33ava6Dfp3", // unnati
            // "HpAYk14jYpomivS4F7oXySN81sdoPvTaHtFsPgiK2jzf", // me
            // "4MXuJrbN8X93oncAvTbhn3rDp11xy9DmyVkD7RrszeP5"     // ujjawal
        ]
        for (let i = 0; i < arr.length; i++) {
            const tx6 = await program.methods
                .universalClose()
                .accounts({
                    admin: phantomSigner.publicKey,
                    targetPda: getUserTicketsPda(new PublicKey(arr[i]), 1)[0],
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