use anchor_lang::prelude::*;
use crate::constants::{TOTAL_TIER_COUNT};

#[account]
#[derive(InitSpace)]
pub struct TierPayouts {
    pub drawing_id: u64,
    pub tier_payouts: [u64; TOTAL_TIER_COUNT as usize],   // 12 tiers
    pub bump: u8,
}