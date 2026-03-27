use anchor_lang::prelude::*;

pub const ADMIN_PUBKEY : Pubkey = pubkey!("H8Q7CUvPigtSxfd13TKRuFrwdJtc6pJu9BMNhbXF9yAY"); // ! Change this to your Origitnal Phantaom Wallet Key
pub const USDC_DEVNET_ADDRESS: Pubkey = pubkey!("4zMMC9srt5RiG2Ck7rrRK9UKVv2vS3Z22nBskqfPAnzD");

pub const PRECISE_UNIT : u64 = 1_000_000_000_000; // 1e12 or 10^12

pub const NORMAL_SELECTABLE_MARBLE_COUNT : u8 = 5;
pub const SPECIAL_SELECTABLE_MARBLE_COUNT : u8 = 1;
pub const MAX_MARBLE_RANGE_COUNT : u8 = 255;
pub const TOTAL_TIER_COUNT : u8 = 12;

pub const MAX_PROTOCOL_FEE : u64 = 2500;
pub const BPS_UNIT : u64 = 10_000;

// # Seeds :
pub const SEED_PER_EPOCH: &[u8] = b"per_epoch_state_account";
pub const SEED_GLOBAL: &[u8] = b"global_state_account";
pub const SEED_LP_DRAWING_STATE : &[u8] = b"drawing_id_to_lp_drawing_state";
pub const SEED_PROTOCOL_USDC_ACCOUNT : &[u8] = b"protocol_usdc_mint_account";
pub const SEED_LP_INFO : &[u8] = b"lp_info_account";
pub const SEED_DRAWING_STATE : &[u8] = b"drawing_state_account";
pub const SEED_TRACKER_PER_EPOCH : &[u8] = b"epoch_to_tracker_account";
