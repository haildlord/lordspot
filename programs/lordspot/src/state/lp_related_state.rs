use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct LPInfo {
    pub consolidated_shares: u64,
    pub last_deposit_info: DepositInfo,
    pub withdrawal_info: WithdrawalInfo,
    pub claimable_withdrawals: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, Copy, InitSpace)]
pub struct DepositInfo {
    pub amount: u64,
    pub epoch_id: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, Copy, InitSpace)]
pub struct WithdrawalInfo {
    pub amount_in_shares: u64,
    pub epoch_id: u64,
}