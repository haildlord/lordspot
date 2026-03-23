use anchor_lang::prelude::*;
// ! at last Dont forget to rearrange the States usign chatgpt cuzz its makes storage and reading efficient

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
    pub lp_target_percent : u64, // lpEdgeTarget
    pub reserve_percent : u64, // reserveRatio,
    pub lp_pool_cap : u64, // JackpotLPManager.sol :: lpPoolCap

    // additional
    pub protocol_usdc_mint_account : Pubkey
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
pub struct EpochIdToLPDrawingState {
    pub lp_pool_total : u64,
    pub pending_deposits : u64,
    pub pending_withdrawals : u64,
    pub bump: u8,
}
