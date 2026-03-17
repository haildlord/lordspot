import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import * as sb from "@switchboard-xyz/on-demand";
import { Wallet } from "@coral-xyz/anchor";

module.exports = async function (provider: anchor.AnchorProvider) {
  anchor.setProvider(provider);

  const wallet = provider.wallet; // H8Q7CUvPigtSxfd13TKRuFrwdJtc6pJu9BMNhbXF9yAY

  const lordsPotProgramId = anchor.workspace.LordsPot.programId; // 7eBJpDhqrtdEyBnrHwNb6QEbJ4YQxz9k2KacKH6oe9W6

  // 5CQmLHNx2PkeeRKCj1qDGJhhFnTxXAcCrhXmdRnq9fiY
  const [randomnessAccountPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_state_account")],
    lordsPotProgramId
  );

  let rngKp: Keypair = Keypair.generate(); // 4oZnGEevR1M7En4RRJMYTNcogwZ4pH7eGVjEvYqJmasA

  const queue = await sb.getDefaultQueue(provider.connection.rpcEndpoint); // EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7

  const sbProgramId = await sb.getProgramId(provider.connection); // Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2

  const sbProgram = await anchor.Program.at(sbProgramId, provider);

  try {

    console.log("Sending TX 1: Creating 1st tx to Switchboard...");

    const [randomness, ix] = await sb.Randomness.create(
      sbProgram as any,
      rngKp,
      queue.pubkey
    );


    const createRandomnessTx = await sb.asV0Tx({
      connection: provider.connection,
      ixs: [ix],
      payer: wallet.publicKey,
      signers: [wallet.payer, rngKp], // fixed this line too
      computeUnitPrice: 75_000,
      computeUnitLimitMultiple: 1.3,
    });

    const sig1 = await provider.connection.sendTransaction(createRandomnessTx, {
      skipPreflight: true,
    });

    console.log(
      "✅ Switchboard Account Successfully confirmed on Devnet! ",
      sig1
    );

    console.log(
      "Sending TX 2: Updating smart contracts switchboard's address..."
    );

    // ────── MANUAL THROW + QUIET CHECK (fixes the "Unknown action" error) ──────
    const tx = await anchor.workspace.LordsPot.methods
      .initialize(rngKp.publicKey)
      .accounts({
        signer: wallet.publicKey,
        randomnessAccount: randomnessAccountPDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .transaction();


    const latestBlockhash = await provider.connection.getLatestBlockhash(
      "confirmed"
    );
    tx.recentBlockhash = latestBlockhash.blockhash;
    tx.feePayer = wallet.publicKey;

    const signedTx = await wallet.signTransaction(tx);
    const signature = await provider.connection.sendRawTransaction(
      signedTx.serialize(),
      {
        skipPreflight: true,
        maxRetries: 10,
      }
    );

    console.log("Transaction sent! Signature:", signature);
    console.log(
      "✅ Smart Contract's Account Successfully Updated on DevNet!",
      signature
    );
  } catch (error) {
    console.error(
      "Error while generating 1st Switchboard account & signing the updated state",
      error
    );
    throw error;
  }
};

// const tx = await anchor.workspace.LordsPot.methods
//   .closeState()
//   .accounts({
//     signer: wallet.publicKey,
//     randomnessAccount: randomnessAccountPDA,
//   })
//   .transaction();



// anchor deploy --provider.cluster https://solana-devnet.g.alchemy.com/v2/nbTtI0XS4ZCs4VoxN_ITW
// .so file deployed : 2Nkn4hstSnThpE2j1SbNwff7ZgRcevzwGb8UdvZ2r6Hc6VyCYzYyw3z9ed8HSdyh9M9qYNYXHSpTGYMAX1YXT6gu

// anchor migrate --provider.cluster "https://devnet.helius-rpc.com/?api-key="
// init or deploy.ts sig :

// anchor idl init --filepath target/idl/lords_pot.json --provider.cluster "https://devnet.helius-rpc.com/?api-key=" 7eBJpDhqrtdEyBnrHwNb6QEbJ4YQxz9k2KacKH6oe9W6
// Idl data length: 719 bytes
// Step 0/719
// Step 600/719
// Idl account created: BcUuVvTAuDQonbE8PDWCaNWomxCJnK9vg7MhsNQx98MP

// solana account 5CQmLHNx2PkeeRKCj1qDGJhhFnTxXAcCrhXmdRnq9fiY --url "https://devnet.helius-rpc.com/?api-key="


// anchor test --skip-local-validator --skip-deploy --provider.cluster "https://devnet.helius-rpc.com/?api-key="