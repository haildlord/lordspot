import * as anchor from "@coral-xyz/anchor";
import * as sb from "@switchboard-xyz/on-demand";
import { LordsPot } from "../target/types/lords_pot";
import { LordsMockUsdc } from "../target/types/lords_mock_usdc";
import {loadOrCreateKeypair} from "../tests/utils/utils";
import {
  DEVNET_SB_PROGRAM_ID,
  DEVNET_QUEUE_PUBKEY,
  getPerEpochStatePda,
  getProtocolUsdcVaultAta, DEVNET_LUSDC_MINT
} from "../tests/utils/seeds_and_ata";

// ============================================================================
// MAIN DEPLOYMENT SCRIPT
// ============================================================================
module.exports = async function (provider: anchor.AnchorProvider) {

  anchor.setProvider(provider);
  const mainWallet = provider.wallet as anchor.Wallet;

  const lordsPotProgram = anchor.workspace.LordsPot as anchor.Program<LordsPot>;
  const lordsMockUsdcProgram = anchor.workspace.LordsMockUsdc as anchor.Program<LordsMockUsdc>;

  // FhfL8dDFL9hH6WYQW3R2n58pjxaCdG6brA9JSZAVksTj
  const rngKp = loadOrCreateKeypair("rng.json");
  // fxa8eqxt3upBxWfDorTPoAi8nfoW1xzjzD1sbUaPahm
  const rngAuthorityKp = loadOrCreateKeypair("rng_authority.json");

  console.log("RNG Account Pubkey:", rngKp.publicKey.toBase58());
  console.log("RNG Authority Pubkey (Keep Private Key safe!):", rngAuthorityKp.publicKey.toBase58());


  // ============================================================================
  // STEP 1: CREATE SWITCHBOARD RANDOMNESS ACCOUNT (FULLY LOCAL FORK MODE)
  // ============================================================================
  console.log("\n--- STEP 1: Setting up Switchboard Randomness ---");

  // 2. Use your STANDARD Localnet provider! No more separate Devnet connection needed.
  const sbProgram = await anchor.Program.at(DEVNET_SB_PROGRAM_ID, provider);

  console.log("Queue Pubkey:", DEVNET_QUEUE_PUBKEY.toBase58());
  console.log("Switchboard Program Pubkey:", DEVNET_SB_PROGRAM_ID.toBase58());

  try {
    const [randomness, ix] = await sb.Randomness.create(
        sbProgram as any,
        rngKp,
        DEVNET_QUEUE_PUBKEY,
        rngAuthorityKp.publicKey
    );

    const createRandomnessTx = await sb.asV0Tx({
      connection: provider.connection, // Back to local!
      ixs: [ix],
      payer: rngAuthorityKp.publicKey, // Paid by the 2 SOL in real Devnet
      signers: [rngKp, rngAuthorityKp],
      computeUnitPrice: 75_000,
      computeUnitLimitMultiple: 1.3,
    });

    const sig1 = await provider.connection.sendTransaction(createRandomnessTx, {
      skipPreflight: false,
    });

    const latestBlockhash = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({
      signature: sig1,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
    }, "confirmed");

    console.log("Switchboard Randomness Account Created Locally! Tx:", sig1);

  } catch (e) {
    console.error("\nCRITICAL FAILURE: Could not create Switchboard Randomness Account!");
    console.error(e);
    // Stop the deployment immediately so we don't deploy a broken protocol
    process.exit(1);
  }

  // ============================================================================
  // STEP 2: INITIALIZE LORDSPOT
  // ============================================================================
  console.log("\n--- STEP 2: Initializing LordsPot ---");

  const initTx = await lordsPotProgram.methods
      .initialize(
          rngKp.publicKey,
          30,
          new anchor.BN(1_100_000).mul(new anchor.BN(1_000_000)),
          new anchor.BN(1_000_000),
          new anchor.BN(300_000_000_000),
          5,
          65,
          80,
          new anchor.BN(0),
          new anchor.BN(100_000).mul(new anchor.BN(1_000_000)),
          new anchor.BN(86400)
      )
      .accounts({
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

  console.log("Initializing LordsPot Tx:", initTx);

  // ============================================================================
  // STEP 3: LP DEPOSIT (1.1 Million USDC)
  // ============================================================================

  console.log("\n--- STEP 3: Initial LP Deposit ---");

  const DEPOSIT_AMOUNT = new anchor.BN(1_100_000).mul(new anchor.BN(1_000_000));

  let tx1 = await lordsMockUsdcProgram.methods.mintMockUsdc(DEPOSIT_AMOUNT).accounts({
    mint: DEVNET_LUSDC_MINT,
    tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID
  }).rpc({ commitment: "confirmed" });

  const depositTx = await lordsPotProgram.methods
      .lpDeposit(DEPOSIT_AMOUNT)
      .accounts({
        depositEpochState: getPerEpochStatePda(0)[0],
        prevPerEpochState: null,
        protocolUsdcVault: getProtocolUsdcVaultAta(),
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      } as any)
      .rpc({ commitment: "confirmed" });

  console.log("LP Deposited! Tx:", depositTx);

  // ============================================================================
  // STEP 4: INIT LORDSPOT (START THE PROTOCOL)
  // ============================================================================
  console.log("\n--- STEP 4: Starting LordsPot Protocol ---");


  const nowTime = new anchor.BN(Math.floor(Date.now() / 1000));

  const initLordsPotTx = await lordsPotProgram.methods
      .initLordspot(nowTime)
      .accounts({
        prevPerEpochStateAccount : null
      })
      .rpc({ commitment: "confirmed" });

  console.log("Protocol Started! Tx:", initLordsPotTx);
  console.log("\nDeployment Complete!");
};