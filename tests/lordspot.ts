import * as anchor from "@coral-xyz/anchor";
import { LordsPot } from "../target/types/lords_pot";
import { PublicKey } from "@solana/web3.js";
import * as sb from "@switchboard-xyz/on-demand";



async function retryCommit(
  randomness: sb.Randomness,
  queue: any,
  maxRetries = 3
): Promise<anchor.web3.TransactionInstruction> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Commit attempt ${attempt}/${maxRetries}...`);
      return await randomness.commitIx(queue.pubkey);
    } catch (error) {
      if (attempt === maxRetries) throw error;
      console.log(`Failed, retrying in 2s...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("All commit attempts failed");
}

async function retryReveal(
  randomness: sb.Randomness,
  maxRetries = 5
): Promise<anchor.web3.TransactionInstruction> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Reveal attempt ${attempt}/${maxRetries}...`);
      return await randomness.revealIx();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      console.log(`Failed, retrying in 2s...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("All reveal attempts failed");
}


describe("lordspot", () => {
  // ❌ REMOVED async HERE
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.LordsPot as anchor.Program<LordsPot>;
  const wallet = provider.wallet;

  // Variables defined here so they are accessible in all 'it' blocks
  let queue: any;
  let sbProgram: any;
  let PDAtoFetch: PublicKey;

  // ✅ This is where all your async setup goes
  before(async () => {
    console.log("🛠️ Starting async setup...");

    [PDAtoFetch] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_state_account")],
      program.programId
    );

    // 1. Get the Queue PublicKey
    const queueAddress = await sb.getDefaultQueue(
      provider.connection.rpcEndpoint
    );

    // 2. Get the Switchboard Program ID
    const sbProgramId = await sb.getProgramId(provider.connection);
    sbProgram = await anchor.Program.at(sbProgramId, provider);

    // 3. THE FIX: Create the Queue Object instead of just the address
    queue = await sb.getDefaultQueue(provider.connection.rpcEndpoint);

    console.log("✅ Setup complete!");
  });


  it.only("Switchboard random number generation", async () => {
    console.log("\n--- 🎲 STARTING RANDOMNESS COMMIT ---");

    try {
      // 1. Fetching State
      console.log("🔍 Fetching PDA state...");
      const dataInRandomValueState =
        await program.account.globalState.fetch(PDAtoFetch);
      const sbAccount = dataInRandomValueState.switchboardRandomAccount;
      console.log(`🔗 Linked Switchboard Account: ${sbAccount.toBase58()}`);

      // 2. Check Switchboard Account Existence
      const accountInfo = await sbProgram.provider.connection.getAccountInfo(
        sbAccount
      );
      if (!accountInfo) {
        throw new Error(
          "❌ Switchboard account not found on-chain. Did you initialize it?"
        );
      }

      console.log("✅ Switchboard account verified on-chain.");

      const randomness = new sb.Randomness(sbProgram as any, sbAccount);

      // 3. Obtain Switchboard Instruction
      console.log(
        "📡 Requesting Commit Instruction from Switchboard Gateway..."
      );
      const commitIx = await retryCommit(randomness, queue);
      console.log("✅ Switchboard commit instruction prepared.");

      // 4. Build Your Program Instruction
      console.log("🏗️ Building LordsPot.commitToRandomNum instruction...");
      const commitToRandomNumTx = await program.methods
        .commitToRandomNum()
        .accounts({
          signer: wallet.publicKey,
          randomnessAccount: PDAtoFetch,
          switchboardRandomAccount: sbAccount,
        })
        .instruction(); // Using .instruction() is cleaner for bundling

      // 5. Bundle and Send
      console.log("📦 Bundling instructions into V0 Transaction...");
      const commitTx = await sb.asV0Tx({
        connection: sbProgram.provider.connection,
        ixs: [commitIx, commitToRandomNumTx],
        payer: wallet.publicKey,
        signers: [(wallet as anchor.Wallet).payer as unknown as any],
        computeUnitPrice: 75_000,
        computeUnitLimitMultiple: 1.6,
      });

      console.log("🚀 Sending Transaction to Devnet...");
      const sig4 = await provider.connection.sendRawTransaction(
        commitTx.serialize(),
        {
          skipPreflight: true,
        }
      );

      console.log(`⏳ Transaction Sent! Signature: ${sig4}`);
      console.log(
        `🔗 View on Solscan: https://solscan.io/tx/${sig4}?cluster=devnet`
      );

      // 6. Wait for Confirmation
      console.log("🔄 Waiting for confirmation...");
      const latestBlockhash = await provider.connection.getLatestBlockhash();
      await provider.connection.confirmTransaction(
        {
          signature: sig4,
          ...latestBlockhash,
        },
        "confirmed"
      );

      console.log(
        "✨ SUCCESS: Randomness committed and program state updated!"
      );

      console.log("Waiting for randomness generation...");
      await new Promise((resolve) => setTimeout(resolve, 3000));

      console.log("Create reveal instruction");
      const revealIx = await retryReveal(randomness);

      console.log("🏗️ Building LordsPot.saveRandomNum instruction...");
      const saveToRandomNumTx = await program.methods
        .saveRandomNum()
        .accounts({
          signer: wallet.publicKey,
          randomnessAccount: PDAtoFetch,
          switchboardRandomAccount: sbAccount,
        })
        .instruction();

      console.log("Bundle reveal + settle in same transaction");
      const revealTx = await sb.asV0Tx({
        connection : sbProgram.provider.connection,
        ixs: [revealIx, saveToRandomNumTx],
        payer: wallet.publicKey,
        signers: [(wallet as anchor.Wallet).payer as unknown as any],
        computeUnitPrice: 75_000,
        computeUnitLimitMultiple: 1.3,
      });

      console.log("🚀 Sending Reveal Transaction to Devnet...");
      const sig5 = await provider.connection.sendRawTransaction(
        revealTx.serialize(),
        {
          skipPreflight: true,
        }
      );

      console.log(`⏳ Reveal Transaction Sent! Signature: ${sig5}`);
      console.log(
        `🔗 View on Solscan: https://solscan.io/tx/${sig5}?cluster=devnet`
      );

      // 6. Wait for Confirmation
      console.log("🔄 Waiting for confirmation...");
      const latestBlockhashForReveal = await provider.connection.getLatestBlockhash();
      await provider.connection.confirmTransaction(
        {
          signature: sig5,
          ...latestBlockhashForReveal,
        },
        "confirmed"
      );

      console.log(
        "✨ SUCCESS: Randomness Revealed and program state updated!"
      );

    } catch (error) {
      console.error("\n❌ Error during Randomness Commit:");
      if (error.logs) {
        console.log("--- PROGRAM LOGS ---");
        console.log(error.logs.join("\n"));
      } else {
        console.log(error);
      }
      throw error;
    }
  });





  it("Fetches the current state of the PDA", async () => {
    console.log("🔍 Running Fetch Test...");
    try {
      const dataInRandomValueState =
        await program.account.globalState.fetch(PDAtoFetch);
      console.log(dataInRandomValueState);
    } catch (err) {
      console.error("❌ Error fetching PDA. Is it initialized?");
      console.error(err);
      throw err;
    }
  });


});