import * as anchor from "@coral-xyz/anchor";
import { LordsPot } from "../target/types/lords_pot";
import { LordsMockUsdc } from "../target/types/lords_mock_usdc";
import {loadOrCreateKeypair} from "../tests/utils/utils";
import { createClient } from '@supabase/supabase-js';
import {
    DEVNET_SB_PROGRAM_ID,
    DEVNET_QUEUE_PUBKEY,
    getPerEpochStatePda,
    getProtocolUsdcVaultAta, DEVNET_LUSDC_MINT, DEVNET_LORDSPOT_PROGRAMID, DEVNET_LUSDC_PROGRAM_ID
} from "../tests/utils/seeds_and_ata";

import dotenv from "dotenv";
dotenv.config();


// ============================================================================
// MAIN DEPLOYMENT SCRIPT
// ============================================================================
module.exports = async function (provider: anchor.AnchorProvider) {

  anchor.setProvider(provider);
  const mainWallet = provider.wallet as anchor.Wallet;

  const lordsPotProgram = anchor.workspace.LordsPot as anchor.Program<LordsPot>;
  const lordsMockUsdcProgram = anchor.workspace.LordsMockUsdc as anchor.Program<LordsMockUsdc>;

  // 4mqNypNWfPnsszBWQPkKGigmUyD7SDh6Z2419FnghQgP
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

  // try {
  //   const [randomness, ix] = await sb.Randomness.create(
  //       sbProgram as any,
  //       rngKp,
  //       DEVNET_QUEUE_PUBKEY,
  //       rngAuthorityKp.publicKey
  //   );
  //
  //   const createRandomnessTx = await sb.asV0Tx({
  //     connection: provider.connection, // Back to local!
  //     ixs: [ix],
  //     payer: rngAuthorityKp.publicKey, // Paid by the 2 SOL in real Devnet
  //     signers: [rngKp, rngAuthorityKp],
  //     computeUnitPrice: 75_000,
  //     computeUnitLimitMultiple: 1.3,
  //   });
  //
  //   const sig1 = await provider.connection.sendTransaction(createRandomnessTx, {
  //     skipPreflight: false,
  //   });
  //
  //   const latestBlockhash = await provider.connection.getLatestBlockhash();
  //   await provider.connection.confirmTransaction({
  //     signature: sig1,
  //     blockhash: latestBlockhash.blockhash,
  //     lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
  //   }, "confirmed");
  //
  //   console.log("Switchboard Randomness Account Created Locally! Tx:", sig1);
  //
  // } catch (e) {
  //   console.error("\nCRITICAL FAILURE: Could not create Switchboard Randomness Account!");
  //   console.error(e);
  //   // Stop the deployment immediately so we don't deploy a broken protocol
  //   process.exit(1);
  // }

  // ============================================================================
  // STEP 2: INITIALIZE LORDSPOT
  // ============================================================================
    console.log("\n--- STEP 1: Initializing LordsPot ---");

    const initTx = await lordsPotProgram.methods
        .initialize(
            rngKp.publicKey,
            22, // normal_marble_max
            new anchor.BN(150_000).mul(new anchor.BN(1_000_000)), // pool_total_cap
            new anchor.BN(1_000_000), // ticket_price: $1.00 USDC
            new anchor.BN(300_000_000_000), // lp_target_percent: 20% House Edge (1e12 scale)
            5,  // special_ball_min: 5 Lord balls
            20, // special_ball_soft_cap: 10 Lord balls
            25, // special_ball_hard_cap: 12 Lord balls
            new anchor.BN(0), // protocol_fee: 0% (Devs take no fee)
            new anchor.BN(0), // protocol_fee_threshold: 0
            new anchor.BN(120) // ! when deploying change : drawing_duration: 1 Day (86400 seconds)
        )
        .accounts({
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .rpc({ commitment: "confirmed" });

    const supabase = createClient(
        `${process.env.SUPABASE_PROJECT_URL}`,
        `${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    );

    const { error } = await supabase
        .from('global_config')
        .upsert({
            id: 1,
            authority_switchboard_random_account: rngAuthorityKp.publicKey.toBase58(),
            devnet_swtichboard_queue : DEVNET_QUEUE_PUBKEY.toBase58(),
            devnet_swtichboard_programid : DEVNET_SB_PROGRAM_ID.toBase58(),
            devnet_protocol_programid : DEVNET_LORDSPOT_PROGRAMID.toBase58(),
            devnet_mock_usdc_mint_address : DEVNET_LUSDC_MINT.toBase58(),
            devnet_mock_usdc_program_address : DEVNET_LUSDC_PROGRAM_ID.toBase58()
        });

    if (error) {
        console.error("Failed to sync authority to DB:", error.message);
    } else {
        console.log("Initializing LordsPot Tx:", initTx);
        console.log("Local Authority synced to Database!");
    }

    // ============================================================================
    // STEP 3: LP DEPOSIT ($10,000 USDC)
    // ============================================================================

    console.log("\n--- STEP 3: Initial LP Deposit ---");

    // Depositing a safe, mathematically supported $10,000 to seed the pool.
    const DEPOSIT_AMOUNT = new anchor.BN(150_000).mul(new anchor.BN(1_000_000));

    // 1. Get the Mint Instruction (DO NOT use .rpc())
    const mintIx = await lordsMockUsdcProgram.methods
        .mintMockUsdc(DEPOSIT_AMOUNT)
        .accounts({
            mint: DEVNET_LUSDC_MINT,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID
        })
        .instruction();

    // 2. Get the Deposit Instruction (DO NOT use .rpc())
    const depositIx = await lordsPotProgram.methods
        .lpDeposit(DEPOSIT_AMOUNT)
        .accounts({
            depositEpochState: getPerEpochStatePda(0)[0],
            prevPerEpochState: null,
            protocolUsdcVault: getProtocolUsdcVaultAta(),
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        } as any)
        .instruction();

    // 3. Bundle them into a single Transaction
    const tx = new anchor.web3.Transaction()
        .add(mintIx)
        .add(depositIx);

    try {
        // 4. Send and confirm via the Provider
        const txSignature = await provider.sendAndConfirm(tx, [], {
            commitment: "confirmed",
            preflightCommitment: "confirmed"
        });

        console.log("Mint & LP Deposit Successful! Tx:", txSignature);
    } catch (err) {
        console.error("Transaction Failed:");
        console.error(err);
    }

    // ============================================================================
    // STEP 3: INIT LORDSPOT (START THE PROTOCOL)
    // ============================================================================
    console.log("\n--- STEP 3: Starting LordsPot Protocol ---");

    const nowTime = new anchor.BN(Math.floor(Date.now() / 1000));

    const initLordsPotTx = await lordsPotProgram.methods
        .initLordspot(nowTime)
        .accounts({
            prevPerEpochStateAccount : null
        })
        .rpc({ commitment: "confirmed" });

    console.log("Protocol Started! Tx:", initLordsPotTx);
    console.log("\nDeployment Complete! LordsPot is Live.");
};