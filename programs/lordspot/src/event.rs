use anchor_lang::prelude::*;

#[event]
pub struct GlobalConfigInitialized {
    pub pool_total_cap: u64,
    pub ticket_price: u64,
    pub normal_marble_max: u8,
    pub drawing_duration: u64,
    pub current_epoch_id: u64,
    pub lp_target_percent : u64,
    pub rngkp: Pubkey,
}

#[event]
pub struct LpDepositedEvent {
    pub user: Pubkey,
    pub epoch_id: u64,
    pub amount_usdc: u64, // The amount they just deposited
}

#[event]
pub struct LpWithdrawInitiatedEvent {
    pub user: Pubkey,
    pub epoch_id: u64,
    pub amount_shares: u64, // The shares they locked up for withdrawal
}

#[event]
pub struct LpWithdrawFinalizedEvent {
    pub user: Pubkey,
    pub epoch_id: u64,
    pub amount_usdc_claimed: u64, // The actual USDC they received in their wallet
}

#[event]
pub struct EpochStartedEvent {
    pub epoch_id: u64,
    pub prize_pool: u64,
    pub special_marble_max: u8,
    pub drawing_time: u64,
    pub total_tickets: u64,
}


#[event]
pub struct TicketsBoughtEvent {
    pub buyer: Pubkey,
    pub epoch_id: u64,
    pub packed_tickets: Vec<u64>,
    pub total_cost: u64,
    pub tickets_count: u64,
}

#[event]
pub struct RandomnessCommittedEvent {
    pub epoch_id: u64,
    pub commit_slot: u64,
}

#[event]
pub struct WinningTicketDrawnEvent {
    pub epoch_id: u64,
    pub packed_winning_ticket: u64,
    pub normal_marble_max: u8, // Emitting this saves the Webhook from querying the DB!
}

#[event]
pub struct EpochSettledEvent {
    pub epoch_id: u64,
    pub prize_pool: u64,
    pub tier_payouts: [u64; 12],
    pub tier_winners: [u64; 12], // We will slightly tweak your helper to return this
    pub total_user_payout: u64,
    pub house_earned: u64
}

#[event]
pub struct TicketClaimedEvent {
    pub epoch_id: u64,
    pub buyer: Pubkey,
    pub packed_ticket: u64,
    pub reward_amount: u64,
}