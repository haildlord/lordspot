import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export const DEVNET_LUSDC_MINT = new PublicKey("6EkfBDuK9TkW3dxFaWqX1rQit9gmYgo4eUMmZVs6H7wH");
export const DEVNET_LUSDC_PROGRAM_ID = new PublicKey("9aURuK86pik3LVQT3nCEF466CfKcKVmNWiETkGegBjx7");
export const DEVNET_LORDSPOT_PROGRAMID = new PublicKey("EWR8si6rA7qL56eqdGVTDwwfo7uXWfL82SisWeiovsu7");

export const SEED_GLOBAL = Buffer.from("global_state_account");
export const SEED_PER_EPOCH = Buffer.from("per_epoch_state_account");
export const SEED_LP_DRAWING_STATE = Buffer.from("drawing_id_to_lp_drawing_state");
export const SEED_LP_INFO = Buffer.from("lp_info_account");
export const SEED_LUSDC_MINT_AUTHORITY = Buffer.from("mint_authority");
export const SEED_DRAWING_STATE = Buffer.from("drawing_state_account");
export const SEED_TICKET_TRACKER = Buffer.from("ticket_tracker");

export const epoch0Buffer = new anchor.BN(0).toArrayLike(Buffer, "le", 8);
export const epoch1Buffer = new anchor.BN(1).toArrayLike(Buffer, "le", 8);

export const [globalStatePda] = PublicKey.findProgramAddressSync(
    [SEED_GLOBAL],
    DEVNET_LORDSPOT_PROGRAMID
);

export const [perEpochState0Pda] = PublicKey.findProgramAddressSync(
    [SEED_PER_EPOCH, epoch0Buffer],
    DEVNET_LORDSPOT_PROGRAMID
);

export const [perEpoch0LPDrawingState] = PublicKey.findProgramAddressSync(
    [SEED_LP_DRAWING_STATE, epoch0Buffer],
    DEVNET_LORDSPOT_PROGRAMID
);

export const [lUsdcMintAuthorityPDA] = PublicKey.findProgramAddressSync(
    [SEED_LUSDC_MINT_AUTHORITY],
    DEVNET_LUSDC_PROGRAM_ID
);

export const [epoch1LpDrawingStatePda] = PublicKey.findProgramAddressSync(
    [SEED_LP_DRAWING_STATE, epoch1Buffer],
    DEVNET_LORDSPOT_PROGRAMID
);

export const [epoch1DrawingStatePda] = PublicKey.findProgramAddressSync(
    [SEED_DRAWING_STATE, epoch1Buffer],
    DEVNET_LORDSPOT_PROGRAMID
);

export const [epoch1TicketTrackerPda] = PublicKey.findProgramAddressSync(
    [SEED_TICKET_TRACKER, epoch1Buffer],
    DEVNET_LORDSPOT_PROGRAMID
);

export const [drawingStateAccount0] = PublicKey.findProgramAddressSync(
    [SEED_DRAWING_STATE, epoch0Buffer],
    DEVNET_LORDSPOT_PROGRAMID
);

export function getLpInfoPda(userPubkey: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [
            SEED_LP_INFO,
            userPubkey.toBuffer()
        ],
        DEVNET_LORDSPOT_PROGRAMID
    );
}

export function getUserMintATA(userPubkey : PublicKey) : PublicKey {
    return anchor.utils.token.associatedAddress({
        mint : DEVNET_LUSDC_MINT,
        owner : userPubkey
    })
}

export const [nextDrawingIdToLpDrawingState] = PublicKey.findProgramAddressSync(
    [SEED_LP_DRAWING_STATE, epoch1Buffer],
    DEVNET_LORDSPOT_PROGRAMID
);

export const [nextDrawingStateAccount] = PublicKey.findProgramAddressSync(
    [SEED_DRAWING_STATE, epoch1Buffer],
    DEVNET_LORDSPOT_PROGRAMID
);

export const [ticketTracker] = PublicKey.findProgramAddressSync(
    [SEED_TICKET_TRACKER, epoch1Buffer],
    DEVNET_LORDSPOT_PROGRAMID
);

export const protocolUsdcVaultAta = anchor.utils.token.associatedAddress({
    mint: DEVNET_LUSDC_MINT,
    owner: globalStatePda // The vault is owned by the global state PDA
});