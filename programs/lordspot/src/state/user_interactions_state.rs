use anchor_lang::prelude::*;

#[account]
pub struct TicketAccount {
    pub owner:        Pubkey,   // 32 — stored for claim verification
    pub draw_id:      u64,      //  8 — which epoch this ticket belongs to
    pub bitvec:       [u8; 32], // 32 — the full encoded ticket
    pub ticket_index: u64,      //  8 — position in draw (= PDA seed)
    pub claimed:      bool,     //  1 — has prize been claimed
    pub bump:         u8,       //  1
}

impl TicketAccount {
    // 8 (discriminator) + 32 + 8 + 32 + 8 + 1 + 1
    pub const LEN: usize = 8 + 32 + 8 + 32 + 8 + 1 + 1;
}