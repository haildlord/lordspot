import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

// ============================================================================
// CONSTANTS & PROGRAM IDs
// ============================================================================
export const DEVNET_LUSDC_MINT = new PublicKey("6EkfBDuK9TkW3dxFaWqX1rQit9gmYgo4eUMmZVs6H7wH");
export const DEVNET_LUSDC_PROGRAM_ID = new PublicKey("9aURuK86pik3LVQT3nCEF466CfKcKVmNWiETkGegBjx7");
export const DEVNET_LORDSPOT_PROGRAMID = new PublicKey("2cm7EMzH5ne9N8A8fDn6e2ZHtpBxwaFrYNGkpQcn8DAi");
export const DEVNET_SB_PROGRAM_ID = new PublicKey("Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2");
export const DEVNET_QUEUE_PUBKEY = new PublicKey("EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7");

// ============================================================================
// SEEDS
// ============================================================================
export const SEED_GLOBAL = Buffer.from("global_state_account");
export const SEED_PER_EPOCH = Buffer.from("per_epoch_state_account");
export const SEED_LP_DRAWING_STATE = Buffer.from("drawing_id_to_lp_drawing_state");
export const SEED_LP_INFO = Buffer.from("lp_info_account");
export const SEED_LUSDC_MINT_AUTHORITY = Buffer.from("mint_authority");
export const SEED_DRAWING_STATE = Buffer.from("drawing_state_account");
export const SEED_TICKET_TRACKER = Buffer.from("ticket_tracker");
export const SEED_USER_TICKETS = Buffer.from("user_tickets");
export const SEED_TIER_PAYOUTS = Buffer.from("tier_payouts_account");

// ============================================================================
// UTILITY HELPERS
// ============================================================================
export const getEpochBuffer = (epochId: number | anchor.BN): Buffer => {
    const bn = typeof epochId === "number" ? new anchor.BN(epochId) : epochId;
    return bn.toArrayLike(Buffer, "le", 8);
};

// ============================================================================
// SINGLETON PDAs (Only one exists per protocol)
// ============================================================================
export const getGlobalStatePda = (): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync([SEED_GLOBAL], DEVNET_LORDSPOT_PROGRAMID);
};

export const getLusdcMintAuthorityPda = (): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync([SEED_LUSDC_MINT_AUTHORITY], DEVNET_LUSDC_PROGRAM_ID);
};

// ============================================================================
// EPOCH-DEPENDENT PDAs (Changes every epoch)
// ============================================================================
export const getPerEpochStatePda = (epochId: number | anchor.BN): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync([SEED_PER_EPOCH, getEpochBuffer(epochId)], DEVNET_LORDSPOT_PROGRAMID);
};

export const getDrawingStatePda = (epochId: number | anchor.BN): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync([SEED_DRAWING_STATE, getEpochBuffer(epochId)], DEVNET_LORDSPOT_PROGRAMID);
};

export const getLpDrawingStatePda = (epochId: number | anchor.BN): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync([SEED_LP_DRAWING_STATE, getEpochBuffer(epochId)], DEVNET_LORDSPOT_PROGRAMID);
};

export const getTicketTrackerPda = (epochId: number | anchor.BN): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync([SEED_TICKET_TRACKER, getEpochBuffer(epochId)], DEVNET_LORDSPOT_PROGRAMID);
};

// ============================================================================
// USER-DEPENDENT PDAs (Changes based on User Wallet)
// ============================================================================
export const getLpInfoPda = (userPubkey: PublicKey): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync([SEED_LP_INFO, userPubkey.toBuffer()], DEVNET_LORDSPOT_PROGRAMID);
};

export const getUserTicketsPda = (userPubkey: PublicKey, epochId: number | anchor.BN): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync(
        [SEED_USER_TICKETS, userPubkey.toBuffer(), getEpochBuffer(epochId)],
        DEVNET_LORDSPOT_PROGRAMID
    );
};

export const getTierPayoutsPda= (epochId: number | anchor.BN): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync(
        [SEED_TIER_PAYOUTS, getEpochBuffer(epochId)],
        DEVNET_LORDSPOT_PROGRAMID
    );
};

// ============================================================================
// ASSOCIATED TOKEN ACCOUNTS (ATAs)
// ============================================================================
export const getProtocolUsdcVaultAta = (): PublicKey => {
    const [globalStatePda] = getGlobalStatePda();
    return anchor.utils.token.associatedAddress({
        mint: DEVNET_LUSDC_MINT,
        owner: globalStatePda
    });
};

export const getUserMintATA = (userPubkey: PublicKey, mint: PublicKey = DEVNET_LUSDC_MINT): PublicKey => {
    return anchor.utils.token.associatedAddress({
        mint: mint,
        owner: userPubkey
    });
};
