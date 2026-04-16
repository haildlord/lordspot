use anchor_lang::prelude::*;

// #[account]
// #[derive(InitSpace)]
// pub struct TicketAccount {
//     pub owner:        Pubkey,   // 32 — stored for claim verification
//     pub draw_id:      u64,      //  8 — which epoch this ticket belongs to
//     pub bitvec:       [u8; 32], // 32 — the full encoded ticket
//     pub ticket_index: u64,      //  8 — position in draw (= PDA seed)
//     pub claimed:      bool,     //  1 — has prize been claimed
//     pub bump:         u8,       //  1
// }

// Global tracker - one per epoch
#[account]
#[derive(InitSpace)]
pub struct TicketTracker {
    pub drawing_id: u64,
    #[max_len(5000)]
    pub packed_tickets: Vec<u64>,   // all tickets bought in this epoch
    pub bump: u8,
}

// User-specific - one per user per epoch
#[account]
#[derive(InitSpace)]
pub struct UserTickets {
    pub owner: Pubkey,
    pub drawing_id: u64,
    #[max_len(100)]
    pub tickets: Vec<u64>,      // packed tickets this user bought
    #[max_len(100)]
    pub claimed: Vec<bool>,     // same length as tickets
    pub bump: u8,
}