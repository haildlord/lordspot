use anchor_lang::prelude::*;

#[account]
pub struct TallyState {
    pub draw_id:                  u64,          //  8
    pub winning_normals_bitvec:   [u8; 32],     // 32 — crank ANDs ticket bitvec with this
    pub winning_special_bit_pos:  u8,           //  1 — crank checks this bit for bonus hit
    pub tier_counts:              [u64; 12],    // 96
    pub tier_payouts:             [u64; 12],    // 96
    pub user_winnings:            u64,          //  8
    pub protocol_fee:             u64,          //  8
    pub cursor:                   u64,          //  8
    pub total_tickets:            u64,          //  8
    pub status:                   TallyStatus,  //  1

    pub bump:                     u8,           //  1
}

impl TallyState {
    // 8 discriminator + 8 + 32 + 1 + 96 + 96 + 8 + 8 + 8 + 8 + 1 + 1
    pub const LEN: usize = 8 + 8 + 32 + 1 + 96 + 96 + 8 + 8 + 8 + 8 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum TallyStatus {
    Tallying,   // crank still running
    Settled,    // crank done, finalizeEpoch can now run
}