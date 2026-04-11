use anchor_lang::prelude::*;

pub const ADMIN_PUBKEY : Pubkey = pubkey!("H8Q7CUvPigtSxfd13TKRuFrwdJtc6pJu9BMNhbXF9yAY"); // ! Change this to your Origitnal Phantaom Wallet Key
pub const DEVNET_ADMIN_PUBKEY : Pubkey = pubkey!("HpAYk14jYpomivS4F7oXySN81sdoPvTaHtFsPgiK2jzf");

pub const MOCK_USDC_DEVNET_ADDRESS: Pubkey = pubkey!("4zMMC9srt5RiG2Ck7rrRK9UKVv2vS3Z22nBskqfPAnzD");

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
pub const SEED_BUCKET : &[u8] = b"ticket_bucket";
pub const SEED_TICKET : &[u8] = b"buyers_ticket";
pub const SEED_TALLY: &[u8] = b"tally_state";
pub const SEED_TREE_AUTHORITY: &[u8]  = b"tree_authority";
pub const METADATA_BASE_URL:   &str   = "https://your-app.railway.app/ticket";


// depth 20 = max 1,048,576 tickets per epoch
pub const TREE_MAX_DEPTH:       u32   = 20;
pub const TREE_MAX_BUFFER_SIZE: u32   = 64;  // concurrent updates allowed
pub const TREE_CANOPY_DEPTH:    u32   = 0;   // 0 = cheapest, no canopy

// Add to the bottom of constants.rs
pub const MIN_PAYOUT: u64 = 1_111_112;
pub const PREMIUM_TIER_MIN_ALLOCATION: u64 = 200_000_000_000; // 20% = 0.2 * PRECISE_UNIT

// Tier configuration
pub const MIN_PAYOUT_TIERS: [bool; 12] = [
    false, true, false, true, true, true, true, true, true, true, true, true,
];

pub const PREMIUM_TIER_WEIGHTS: [u64; 12] = [
    0, 0, 0, 120_000_000_000,   // 12%
    0, 120_000_000_000,         // 12%
    120_000_000_000,            // 12%
    60_000_000_000,             // 6%
    60_000_000_000, 60_000_000_000, 60_000_000_000,  // 6%
    400_000_000_000,            // 40%
];
