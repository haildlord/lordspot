use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct DrawingState {
    // ── 8-byte aligned fields first (u64) ─────────────────────
    pub prize_pool:      u64,   // 8
    pub lp_earnings:     u64,   // 8
    pub drawing_time:    u64,   // 8
    pub winning_ticket:  u64,   // 8
    pub total_tickets:   u64,   // 8 ← total 40 bytes

    // ── Small fields grouped together at the end ─────────────
    pub special_marble_max: u8,     // 1
    pub lordspot_lock:      bool,   // 1
    pub bump:               u8,     // 1 ← total 3 bytes
}

#[account]
#[derive(InitSpace)]
pub struct GlobalState {
    // ── PDA Bumps ─────────────────────────────────────
    pub bump: u8,                   // GlobalState bump

    // ── Switchboard / Oracle Config ───────────────────
    pub switchboard_random_account: Pubkey,

    // ── Core Game Configuration (set once at init) ─────
    pub pool_total_cap: u64,           // governance cap (1.1M USDC)
    pub normal_marble_max: u8,
    pub ticket_price: u64,
    pub lp_target_percent: u64,
    pub edge_per_ticket: u64,

    pub special_ball_min: u8,
    pub special_ball_soft_cap: u8,
    pub special_ball_hard_cap: u8,

    pub protocol_fee: u64,
    pub protocol_fee_threshold: u64,

    // ── Runtime State ──────────────────────────────────
    pub current_epoch_id: u64,
    pub commit_slot: u64,
    pub lp_pool_cap: u64,

    // ── Governance Flags ───────────────────────────────
    pub allow_ticket_purchase: bool,
    pub drawing_duration: u64,
}

#[account]
#[derive(InitSpace)]
pub struct PerEpochState {
    pub shares_percentage : u64, // drawingAccumulator[drawingId]
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