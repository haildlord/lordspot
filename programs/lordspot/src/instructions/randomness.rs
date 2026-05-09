use anchor_lang::prelude::*;
use solana_program::hash::hashv;
use crate::constants::{SEED_GLOBAL, SEED_DRAWING_STATE, SEED_LP_DRAWING_STATE, SEED_TIER_PAYOUTS, SEED_TICKET_TRACKER, TOTAL_TIER_COUNT, SEED_PER_EPOCH, NORMAL_SELECTABLE_MARBLE_COUNT, SPECIAL_SELECTABLE_MARBLE_COUNT};
use switchboard_on_demand::accounts::RandomnessAccountData;
use crate::error::LordspotError;
use crate::state::{DrawingState, GlobalState, TierPayouts, TicketTracker, EpochIdToLPDrawingState, PerEpochState};
use crate::utility::{fisher_yates_draw, calculate_tier_winners_and_payouts, pack_ticket, calculate_ticket_tier, process_drawing_settlement, _set_new_drawing_state};
use crate::event::*;

pub fn commit_to_random_num_handler(ctx : Context<CommitToRandomNum>) -> Result<()> {
    let state = &mut ctx.accounts.global_state_account;
    let current_drawing = &mut ctx.accounts.drawing_state;

    let clock = Clock::get()?;
    let time_now = clock.unix_timestamp as u64;

    require!(current_drawing.drawing_time <= time_now, LordspotError::CameTooEarlyToRunLordsPot);

    current_drawing.lordspot_lock = true;

    let randomness_data = RandomnessAccountData::parse(
        ctx.accounts.switchboard_random_account.data.borrow()
    ).map_err(|_| LordspotError::RandomnessParseFailed)?;

    msg!("[COMMIT] Slot: {} | SB Seed Slot: {}", clock.slot, randomness_data.seed_slot);

    // If the SDK sets it to Slot + 1, we verify exactly that.
    // This ensures the randomness account was updated in THIS transaction.
    require!(
        randomness_data.seed_slot == clock.slot - 1,
        LordspotError::SlotMismatch
    );

    require!(randomness_data.get_value(clock.slot).is_err(), LordspotError::AlreadyRevealedRandomValue);

    state.commit_slot = randomness_data.seed_slot;

    emit!(RandomnessCommittedEvent {
        epoch_id: state.current_epoch_id,
        commit_slot: state.commit_slot,
    });

    Ok(())
}

pub fn save_random_num_handler(ctx: Context<SaveRandomNum>, use_known_winning_ticket : bool) -> Result<()> {
    let global = &mut ctx.accounts.global_state_account;
    let drawing = &mut ctx.accounts.drawing_state;
    let clock = Clock::get()?;

    // 1. Parse and Verify Switchboard Randomness
    let randomness_data = RandomnessAccountData::parse(
        ctx.accounts.switchboard_random_account.data.borrow()
    ).map_err(|_| LordspotError::RandomnessParseFailed)?;

    require!(
        randomness_data.seed_slot == global.commit_slot,
        LordspotError::SeedMisMatch
    );

    // 2. Fetch the Master Seed revealed by the Oracle
    let master_seed = randomness_data
        .get_value(clock.slot)
        .map_err(|_| LordspotError::UnresolvedRandomness)?;

    // --- DRAW 1: Normal Marbles ---
    // Deriving unique sub-seed for the normal set (Index 0)
    let normal_sub_seed = hashv(&[
        &master_seed,
        &0u64.to_le_bytes(),
    ]).to_bytes();

    let winning_normals = fisher_yates_draw(
        normal_sub_seed,
        1,
        global.normal_marble_max, // From GlobalState
        NORMAL_SELECTABLE_MARBLE_COUNT // Constant: 5
    )?;

    // --- DRAW 2: Special Marble ---
    // Deriving unique sub-seed for the special set (Index 1)
    let special_sub_seed = hashv(&[
        &master_seed,
        &1u64.to_le_bytes(),
    ]).to_bytes();

    let winning_special = fisher_yates_draw(
        special_sub_seed,
        1,
        drawing.special_marble_max, // From DrawingState
        SPECIAL_SELECTABLE_MARBLE_COUNT // Constant: 1
    )?;

    // --- PACKING & STATE UPDATE ---
    // Use your utility to pack the [u8; 5] and the u8 special ball into the u64
    // We pass winning_special[0] because fisher_yates returns a Vec
    drawing.winning_ticket = if use_known_winning_ticket == true {
        134217790 // ([1, 2, 3, 4, 5] | 5) with normal_max = 22
    } else {
        pack_ticket(&winning_normals, winning_special[0], global.normal_marble_max)?
    };

    ctx.accounts.next_drawing_state_account.bump = ctx.bumps.next_drawing_state_account;
    ctx.accounts.next_ticket_tracker.bump = ctx.bumps.next_ticket_tracker;


    msg!("🎰 Drawing Finalized for Epoch: {}", global.current_epoch_id);
    msg!("Packed Winning Ticket: {}", drawing.winning_ticket);

    emit!(WinningTicketDrawnEvent {
        epoch_id: global.current_epoch_id,
        packed_winning_ticket: drawing.winning_ticket,
        normal_marble_max: global.normal_marble_max,
    });

    Ok(())
}

pub fn run_lordspot_handler(ctx: Context<RunLordspot>) -> Result<()> {

    let drawing = &mut ctx.accounts.drawing_state_account;
    let tracker = &ctx.accounts.ticket_tracker;
    let global  = &mut ctx.accounts.global_state_account;

    // 1. Setup the two tracking arrays
    let mut unique_tickets_per_tier = [0u64; TOTAL_TIER_COUNT as usize];
    let mut dup_tickets_per_tier = [0u64; TOTAL_TIER_COUNT as usize];

    // 2. Count Unique Tickets
    for &packed in &tracker.unique_tickets {
        let tier = calculate_ticket_tier(packed, drawing.winning_ticket, global.normal_marble_max);
        unique_tickets_per_tier[tier as usize] += 1;
    }

    // 3. Count Duplicate Tickets
    for &packed in &tracker.duplicate_tickets {
        let tier = calculate_ticket_tier(packed, drawing.winning_ticket, global.normal_marble_max);
        dup_tickets_per_tier[tier as usize] += 1;
    }

    // 4. Pass BOTH arrays to the calculator
    let (tier_payouts_array, tier_winners_array, total_user_payout) =
        calculate_tier_winners_and_payouts(
            drawing.prize_pool,
            global.normal_marble_max,
            drawing.special_marble_max,
            &unique_tickets_per_tier,
            &dup_tickets_per_tier,
        );

    ctx.accounts.tier_payouts_account.tier_payouts = tier_payouts_array;

    ctx.accounts.tier_payouts_account.bump = ctx.accounts.tier_payouts_account.bump;
    ctx.accounts.next_lp_drawing_state.bump = ctx.bumps.next_lp_drawing_state;
    ctx.accounts.current_per_epoch_state.bump = ctx.bumps.current_per_epoch_state;

    let guaranteed_house_cut = drawing.total_tickets
        .checked_mul(global.edge_per_ticket)
        .unwrap_or(0);

    // --- NEW: Emit the Settlement Event BEFORE we modify the drawing state! ---
    emit!(EpochSettledEvent {
        epoch_id: global.current_epoch_id,
        prize_pool: drawing.prize_pool,
        tier_payouts: tier_payouts_array,
        tier_winners: tier_winners_array,
        total_user_payout,
        house_earned: guaranteed_house_cut
    });

    let (new_lp_value, _) = process_drawing_settlement(
        global,
        &ctx.accounts.lp_drawing_state,
        drawing.lp_earnings,
        &mut ctx.accounts.current_per_epoch_state,
        &ctx.accounts.prev_per_epoch_state,
        total_user_payout,
        0,
    )?;

    let clock = Clock::get()?;
    let time_now = clock.unix_timestamp as u64;
    let new_deadline = time_now
        .checked_add(global.drawing_duration)
        .ok_or(LordspotError::AirthMaticOverflow)?;
    
    _set_new_drawing_state(
        global,
        &mut ctx.accounts.next_lp_drawing_state,
        drawing,
        new_lp_value,
        new_deadline
    )?;

    drawing.lordspot_lock = false;

    Ok(())
}


#[derive(Accounts)]
pub struct CommitToRandomNum<'info>{

    #[account(mut)]
    pub signer : Signer<'info>,

    #[account(
        mut,
        has_one = switchboard_random_account,
        seeds = [SEED_GLOBAL],
        bump = global_state_account.bump
    )]
    pub global_state_account: Account<'info, GlobalState>,

    /// CHECK : above has_one makes sure its the right one
    pub switchboard_random_account: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [SEED_DRAWING_STATE, global_state_account.current_epoch_id.to_le_bytes().as_ref()],
        bump = drawing_state.bump,
        // ! uncomment this line : constraint = drawing_state.lordspot_lock == false @ LordspotError::LordspotAlreadyLocked,
    )]
    pub drawing_state: Account<'info, DrawingState>,
}

#[derive(Accounts)]
pub struct SaveRandomNum<'info>{

    #[account(mut)]
    pub signer : Signer<'info>,

    #[account(
        mut,
        has_one = switchboard_random_account,
        seeds = [SEED_GLOBAL],
        bump = global_state_account.bump
    )]
    pub global_state_account: Account<'info, GlobalState>,

    /// CHECK : above has_one makes sure its the right one
    pub switchboard_random_account: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [SEED_DRAWING_STATE, global_state_account.current_epoch_id.to_le_bytes().as_ref()],
        bump = drawing_state.bump,
        constraint = drawing_state.lordspot_lock == true @ LordspotError::LordspotNotLocked,
    )]
    pub drawing_state: Account<'info, DrawingState>,

    #[account(
        init_if_needed, // ! should be init when deploying
        payer = signer,
        space = 8 + DrawingState::INIT_SPACE,
        seeds = [SEED_DRAWING_STATE, (global_state_account.current_epoch_id + 1).to_le_bytes().as_ref()],
        bump,
    )]
    pub next_drawing_state_account: Account<'info, DrawingState>,

    #[account(
        init_if_needed, // ! should be init when deploying
        payer = signer,
        space = 8 + TicketTracker::INIT_SPACE,
        seeds = [SEED_TICKET_TRACKER, (global_state_account.current_epoch_id + 1).to_le_bytes().as_ref()],
        bump,
    )]
    pub next_ticket_tracker: Account<'info, TicketTracker>,

    pub system_program: Program<'info, System>,
}


#[derive(Accounts)]
pub struct RunLordspot<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(mut, seeds = [SEED_GLOBAL], bump = global_state_account.bump)]
    pub global_state_account: Account<'info, GlobalState>,

    #[account(
        mut,
        seeds = [SEED_DRAWING_STATE, global_state_account.current_epoch_id.to_le_bytes().as_ref()],
        bump = drawing_state_account.bump,
        constraint = drawing_state_account.lordspot_lock == true @ LordspotError::LordspotNotLocked,
    )]
    pub drawing_state_account: Account<'info, DrawingState>,

    #[account(
        mut,
        seeds = [SEED_TICKET_TRACKER, global_state_account.current_epoch_id.to_le_bytes().as_ref()],
        bump = ticket_tracker.bump,
    )]
    pub ticket_tracker: Account<'info, TicketTracker>,

    #[account(
        init_if_needed, // ! should be init when deploying
        payer = signer,
        space = 8 + TierPayouts::INIT_SPACE,
        seeds = [SEED_TIER_PAYOUTS, global_state_account.current_epoch_id.to_le_bytes().as_ref()],
        bump
    )]
    pub tier_payouts_account: Account<'info, TierPayouts>,

    // Current epoch LP state
    #[account(
        mut,
        seeds = [SEED_LP_DRAWING_STATE, global_state_account.current_epoch_id.to_le_bytes().as_ref()],
        bump = lp_drawing_state.bump,
    )]
    pub lp_drawing_state: Account<'info, EpochIdToLPDrawingState>,

    // Next epoch LP state (will be created / updated)
    #[account(
        init_if_needed, // ! should be init when deploying
        payer = signer,
        space = 8 + EpochIdToLPDrawingState::INIT_SPACE,
        seeds = [SEED_LP_DRAWING_STATE, (global_state_account.current_epoch_id + 1).to_le_bytes().as_ref()],
        bump
    )]
    pub next_lp_drawing_state: Account<'info, EpochIdToLPDrawingState>,

    // Next epoch PerEpochState (used by process_drawing_settlement)
    #[account(
        init_if_needed, // ! should be init when deploying
        payer = signer,
        space = 8 + PerEpochState::INIT_SPACE,
        seeds = [SEED_PER_EPOCH, global_state_account.current_epoch_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub current_per_epoch_state: Account<'info, PerEpochState>,

    // Previous epoch PerEpochState (Option, used by process_drawing_settlement)
    #[account(
        seeds = [SEED_PER_EPOCH, (global_state_account.current_epoch_id - 1).to_le_bytes().as_ref()],
        bump,
    )]
    pub prev_per_epoch_state: Option<Account<'info, PerEpochState>>,

    pub system_program: Program<'info, System>,
}