use anchor_lang::prelude::*;

// Global tracker - one per epoch
#[account]
#[derive(InitSpace)]
pub struct TicketTracker {
    pub drawing_id: u64,
    #[max_len(600)]
    pub unique_tickets: Vec<u64>,
    #[max_len(600)]
    pub duplicate_tickets: Vec<u64>, // all tickets bought in this epoch
    pub bump: u8,
}

// User-specific - one per user per epoch
#[account]
#[derive(InitSpace)]
pub struct UserTickets {
    pub owner: Pubkey,
    pub drawing_id: u64,
    #[max_len(50)]
    pub tickets: Vec<u64>,      // packed tickets this user bought
    #[max_len(50)]
    pub claimed: Vec<bool>,     // same length as tickets
    pub bump: u8,
}