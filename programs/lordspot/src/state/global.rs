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
    pub switchboard_random_account: Pubkey,
    pub bump: u8,
    pub commit_slot: u64,
    pub rand_value: Option<u32>,

    // my state
    pub pool_total_cap : u64, // governancePoolCap
    pub current_epoch_id : u64,  // currentDrawingId
    pub normal_marble_max : u8, //  normalBallMax
    pub ticket_price : u64, // ticketPrice
    pub edge_per_ticket : u64,
    pub lp_target_percent : u64, // lpEdgeTarget
    pub reserve_percent : u64, // reserveRatio,
    pub lp_pool_cap : u64, // JackpotLPManager.sol :: lpPoolCap
    pub special_ball_min : u8,
    pub allow_ticket_purchase : bool,


    // additional
    pub protocol_usdc_vault_bump : u8,
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
