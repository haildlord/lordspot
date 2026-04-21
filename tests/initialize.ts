import * as anchor from "@coral-xyz/anchor";
import { LordsPot } from "../target/types/lords_pot";
import {PublicKey} from "@solana/web3.js";
import { assert } from "chai"

describe("initialize", () => {

    let anchorProvider = anchor.AnchorProvider.env();
    anchor.setProvider(anchorProvider);

    let lordsPotProgram = anchor.workspace.LordsPot as anchor.Program<LordsPot>;
    let lusdcProgram : anchor.Program;

    let default_anchor_wallet = anchorProvider.wallet;

    let DEVNET_LUSDC_MINT = new PublicKey("6EkfBDuK9TkW3dxFaWqX1rQit9gmYgo4eUMmZVs6H7wH");
    let DEVNET_LUSDC_PROGRAM = new PublicKey("9aURuK86pik3LVQT3nCEF466CfKcKVmNWiETkGegBjx7");

    let anchor_wallet_lusdc_ata = anchor.utils.token.associatedAddress({
        mint: DEVNET_LUSDC_MINT,
        owner: default_anchor_wallet.publicKey
    });

    let lordspot_lusdc_ata = anchor.utils.token.associatedAddress({
        mint : DEVNET_LUSDC_MINT,
        owner : lordsPotProgram.programId
    })

    const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint_authority")],
        DEVNET_LUSDC_PROGRAM
    );

    before(async () => {

        lusdcProgram = await anchor.Program.at(DEVNET_LUSDC_PROGRAM, anchorProvider);
        console.log("Program ID:", lusdcProgram.programId.toBase58());

    })

    it('mint wallet some lordsUSDC', async () => {

        const MINT_AMOUNT = new anchor.BN(1100000 * 1_000_000);

        const txSig = await lusdcProgram.methods.mintMockUsdc(MINT_AMOUNT).accounts({
            signer : default_anchor_wallet.publicKey,
            mint : DEVNET_LUSDC_MINT,
            destination : anchor_wallet_lusdc_ata,
            mintAuthorityPda,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
        }).signers([default_anchor_wallet.payer as anchor.web3.Keypair]).rpc();

        const balanceInfo = await anchorProvider.connection.getTokenAccountBalance(
            anchor_wallet_lusdc_ata
        );

        assert.equal(
            balanceInfo.value.uiAmount,
            1100000,
            `Should have exactly 1,100,000 LUSDC (got ${balanceInfo.value.uiAmount})`
        );
    })

    it('should initialize LordsPot successfully', async () => {

    })

})

// surfpool start --rpc-url "https://devnet.helius-rpc.com/?api-key=311a52e8-93ed-49e4-b0c5-acfb3060e402" --db sqlite://./lordspot-surfnet.db --surfnet-id lordspot-dev --legacy-anchor-compatibility --no-tui