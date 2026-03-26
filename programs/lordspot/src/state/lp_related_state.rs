use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct LPInfo {
    pub consolidated_shares : u64, // Note: this is the amount in shares, not usdc
    pub last_deposit_info : DepositInfo, // Note: this is the amount in usdc, not shares
    pub withdrawal_info : WithdrawalInfo, // Note: this is the amount in shares, not usdc
    pub claimable_withdrawals : u64, // Note: this is the amount in usdc, not shares
    pub bump : u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, Copy, InitSpace)]
pub struct DepositInfo {
    pub amount : u64,
    pub epoch_id : u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, Copy, InitSpace)]
pub struct WithdrawalInfo {
    pub amount_in_shares : u64,
    pub epoch_id : u64,
}