use anchor_lang::prelude::*;
use crate::constants::*;
use crate::error::LordspotError;
// ! at last Dont forget to rearrange the States usign chatgpt cuzz its makes storage and reading efficient

#[account]
#[derive(InitSpace)]
pub struct DrawingState {
    pub prize_pool : u64,
    pub lp_earnings : u64, // is set to 0 in start of every epoch
    pub special_marble_max : u8, // is decided on start of each epoch based on the liquidity in the poll at the start of the epoch
    pub drawing_time : u64,
    pub winning_ticket : u64,
    pub lordspot_lock : bool,
    pub total_tickets: u64,

    pub bump : u8,
}


#[account]
#[derive(InitSpace)]
pub struct GlobalState {
    // your existing fields stay exactly as they are
    pub switchboard_random_account: Pubkey,
    pub bump:                       u8,
    pub commit_slot:                u64,
    pub rand_value:                 Option<[u8; 32]>,
    
    pub pool_total_cap:             u64,
    pub current_epoch_id:           u64,
    pub normal_marble_max:          u8,
    pub ticket_price:               u64,
    pub edge_per_ticket:            u64,
    pub lp_target_percent:          u64,
    pub lp_pool_cap:                u64,
    pub special_ball_min:           u8,
    pub allow_ticket_purchase:      bool,
    pub protocol_usdc_vault_bump:   u8,

    // 👇 ADD THESE FOUR — this fixes errors 1 and 2
    pub special_ball_hard_cap:      u8,
    pub tier_weights:               [u64; 12],
    pub protocol_fee_rate:          u64,
    pub drawing_duration:           u64,
}

#[account]
#[derive(InitSpace)]
pub struct PerEpochState {
    pub shares_percentage : u64, // drawingAccumulator[drawingId]
    pub epoch_id : u64, // drawingId
    pub bump : u8,
}

#[account]
#[derive(InitSpace)]
pub struct EpochIdToLPDrawingState { // mapping(drawingId => LPDrawingState) internal lpDrawingState;
    pub lp_pool_total : u64,
    pub pending_deposits : u64,
    pub pending_withdrawals : u64,
    pub bump: u8,
}
