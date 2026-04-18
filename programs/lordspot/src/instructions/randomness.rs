use anchor_lang::prelude::*;
use crate::constants::{ADMIN_PUBKEY, SEED_GLOBAL, SEED_DRAWING_STATE, SEED_LP_DRAWING_STATE, SEED_TIER_PAYOUTS, SEED_TICKET_TRACKER, TOTAL_TIER_COUNT, SEED_PER_EPOCH};
use switchboard_on_demand::accounts::RandomnessAccountData;
use crate::error::LordspotError;
use crate::state::{DrawingState, GlobalState, TierPayouts, TicketTracker, EpochIdToLPDrawingState, PerEpochState};
use crate::utility::{compute_winning_bitvec, calculate_special_marble_max, calculate_tier_winners_and_payouts, pack_ticket, calculate_ticket_tier, calculate_tier_total_winning_combos, process_drawing_settlement, _set_new_drawing_state};


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
randomness_data.seed_slot == clock.slot + 1,
LordspotError::SlotMismatch
);

    require!(randomness_data.get_value(clock.slot).is_err(), LordspotError::AlreadyRevealedRandomValue);

    state.commit_slot = randomness_data.seed_slot;

    Ok(())
}

pub fn save_random_num_handler(ctx: Context<SaveRandomNum>) -> Result<()> {
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
    // let normal_sub_seed = keccak::hashv(&[&master_seed, &0u64.to_le_bytes()]).to_bytes();
    // let winning_normals = fisher_yates_draw(
    //     normal_sub_seed,
    //     1,
    //     global.normal_marble_max, // From GlobalState
    //     NORMAL_SELECTABLE_MARBLE_COUNT // Constant: 5
    // )?;

    // --- DRAW 2: Special Marble ---
    // Deriving unique sub-seed for the special set (Index 1)
    // let special_sub_seed = keccak::hashv(&[&master_seed, &1u64.to_le_bytes()]).to_bytes();
    // let winning_special = fisher_yates_draw(
    //     special_sub_seed,
    //     1,
    //     drawing.special_marble_max, // From DrawingState
    //     SPECIAL_SELECTABLE_MARBLE_COUNT // Constant: 1
    // )?;

    // --- PACKING & STATE UPDATE ---
    // Use your utility to pack the [u8; 5] and the u8 special ball into the u64
    // We pass winning_special[0] because fisher_yates returns a Vec
    // drawing.winning_ticket = pack_ticket(&winning_normals, winning_special[0]);

    // 🔓 Unlock the state as the drawing is now finalized
    drawing.lordspot_lock = false;

    // Optional: We can leave rand_value as None or clear it to signify completion
    global.rand_value = None;

    msg!("🎰 Drawing Finalized for Epoch: {}", global.current_epoch_id);
    msg!("Packed Winning Ticket: {}", drawing.winning_ticket);

    Ok(())
}

// ! any for loop for longer duration would practically make the protocol DOS, cuzz protocol is gonna be locked and you cannot run_jackpot_handler to make it false
// ! also you wont be manually delete tickets from users & global tracker !
pub fn run_jackpot_handler(
    ctx: Context<RunJackpot>
) -> Result<()> {

    let drawing = &mut ctx.accounts.drawing_state_account;
    let tracker = &ctx.accounts.ticket_tracker;
    let global  = &mut ctx.accounts.global_state_account;

    // 1. Pack the winning ticket
    // let winning_packed = pack_ticket(
    //     &normal_balls,
    //     bonus_ball,
    //     global.normal_marble_max,
    // );
    // drawing.winning_ticket = winning_packed;

    // 2. Count real user tickets per tier
    let mut real_tickets_per_tier = [0u64; TOTAL_TIER_COUNT as usize];

    // for &packed in &tracker.packed_tickets {
    //     let tier = calculate_ticket_tier(
    //         packed,
    //         winning_packed,
    //         global.normal_marble_max,
    //     );
    //     real_tickets_per_tier[tier as usize] += 1;
    // }

    // 3. Calculate tier winners + payouts using your existing utility
    let (tier_winners, tier_payouts_array, _use_min, _min_alloc, total_user_payout) =
        calculate_tier_winners_and_payouts(
            drawing.prize_pool,
            global.normal_marble_max,
            drawing.special_marble_max,
            &real_tickets_per_tier,
        );

    // 4. Store the 12 tier payouts
    ctx.accounts.tier_payouts_account.tier_payouts = tier_payouts_array;
    ctx.accounts.tier_payouts_account.drawing_id = global.current_epoch_id;

    // 5. Run LP settlement — using your existing function signature
    let (new_lp_value, _) = process_drawing_settlement(
        global,
        &ctx.accounts.lp_drawing_state,          // current epoch LP state
        drawing.lp_earnings,
        &mut ctx.accounts.next_per_epoch_state,   // next epoch state (mut)
        &ctx.accounts.prev_per_epoch_state,       // previous epoch state (Option)
        total_user_payout,
        0,                                       // protocol_fee_amount
    )?;

    // 6. Move to next epoch — using your existing function signature
    _set_new_drawing_state(
        global,
        &mut ctx.accounts.next_lp_drawing_state,   // next epoch LP state
        drawing,
        new_lp_value,
        // next drawing time (you can pass drawing.drawing_time + drawing_duration)
        drawing.drawing_time
            .checked_add(global.drawing_duration)
            .ok_or(LordspotError::AirthMaticOverflow)?,
    )?;

    // 7. Unlock the lordspot lock
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
constraint = drawing_state.lordspot_lock == false @ LordspotError::LordspotAlreadyLocked,
    )]
    pub drawing_state: Account<'info, DrawingState>,
}

#[derive(Accounts)]
pub struct SaveRandomNum<'info>{
    #[account(mut, address = ADMIN_PUBKEY @ LordspotError::InvalidOwner)]
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
seeds = [SEED_DRAWING_STATE, global_state_account.current_epoch_id.to_le_bytes().as_ref()],
bump = drawing_state.bump,
constraint = drawing_state.lordspot_lock == true @ LordspotError::LordspotNotLocked,
    )]
    pub drawing_state: Account<'info, DrawingState>,
}


#[derive(Accounts)]
pub struct RunJackpot<'info> {
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
init,
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
mut,
seeds = [SEED_LP_DRAWING_STATE, (global_state_account.current_epoch_id + 1).to_le_bytes().as_ref()],
bump = next_lp_drawing_state.bump,
    )]
    pub next_lp_drawing_state: Account<'info, EpochIdToLPDrawingState>,

    // Next epoch PerEpochState (used by process_drawing_settlement)
    #[account(
mut,
seeds = [SEED_PER_EPOCH, (global_state_account.current_epoch_id + 1).to_le_bytes().as_ref()],
bump = next_per_epoch_state.bump,
    )]
    pub next_per_epoch_state: Account<'info, PerEpochState>,

    // Previous epoch PerEpochState (Option, used by process_drawing_settlement)
    #[account(
seeds = [SEED_PER_EPOCH, global_state_account.current_epoch_id.to_le_bytes().as_ref()],
bump,
    )]
    pub prev_per_epoch_state: Option<Account<'info, PerEpochState>>,

    pub system_program: Program<'info, System>,
}