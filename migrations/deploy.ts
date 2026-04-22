import * as anchor from "@coral-xyz/anchor";
import * as sb from "@switchboard-xyz/on-demand";
import { LordsPot } from "../target/types/lords_pot";
import {loadOrCreateKeypair} from "../tests/utils/utils";
import {
  protocolUsdcVaultAta,
  perEpochState0Pda,
} from "../tests/utils/seeds_and_ata";

// ============================================================================
// MAIN DEPLOYMENT SCRIPT
// ============================================================================
module.exports = async function (provider: anchor.AnchorProvider) {

  anchor.setProvider(provider);
  const wallet = provider.wallet as anchor.Wallet;

  console.log("Deploying to Surfnet (persistent):", provider.connection.rpcEndpoint);
  console.log("Default Deployer Wallet:", wallet.publicKey.toBase58());

  const lordsPotProgram = anchor.workspace.LordsPot as anchor.Program<LordsPot>;
  const rngKp = loadOrCreateKeypair("rng.json");
  const rngAuthorityKp = loadOrCreateKeypair("rng_authority.json");

  console.log("RNG Account Pubkey:", rngKp.publicKey.toBase58());
  console.log("RNG Authority Pubkey (Keep Private Key safe!):", rngAuthorityKp.publicKey.toBase58());

  const queue = await sb.getDefaultQueue(provider.connection.rpcEndpoint);
  const sbProgramId = await sb.getProgramId(provider.connection);
  const sbProgram = await anchor.Program.at(sbProgramId, provider);

  // ============================================================================
  // STEP 1: CREATE SWITCHBOARD RANDOMNESS ACCOUNT
  // ============================================================================
  console.log("\n--- STEP 1: Setting up Switchboard Randomness ---");

  try {
    const [randomness, ix] = await sb.Randomness.create(
        sbProgram as any,
        rngKp,
        queue.pubkey,
        rngAuthorityKp.publicKey
    );

    const createRandomnessTx = await sb.asV0Tx({
      connection: provider.connection,
      ixs: [ix],
      payer: wallet.publicKey,
      signers: [wallet.payer, rngKp, rngAuthorityKp],
      computeUnitPrice: 75_000,
      computeUnitLimitMultiple: 1.3,
    });

    const sig1 = await provider.connection.sendTransaction(createRandomnessTx, {
      skipPreflight: true,
    });
    console.log("Switchboard Randomness Account Created! Tx:", sig1);
  } catch (e) {
    console.log("Switchboard account might already exist. Proceeding...");
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

  const depositTx = await lordsPotProgram.methods
      .lpDeposit(DEPOSIT_AMOUNT)
      .accounts({
        depositEpochState: perEpochState0Pda,
        prevPerEpochState: null,
        protocolUsdcVault: protocolUsdcVaultAta,
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