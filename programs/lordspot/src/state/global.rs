use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct GlobalState {
    pub switchboard_random_account: Pubkey,
    pub bump: u8,
    pub commit_slot: u64,
    pub rand_value: Option<u32>,
}