use anchor_lang::prelude::*;
use crate::constants::{ADMIN_PUBKEY, SEED_GLOBAL, SEED_DRAWING_STATE, SEED_LP_DRAWING_STATE, SEED_TALLY, PRECISE_UNIT, PROTOCOL_FEE};
use switchboard_on_demand::accounts::RandomnessAccountData;
use crate::error::LordspotError;
use crate::state::{DrawingState, GlobalState, EpochIdToLPDrawingState, TallyState, TallyStatus, TicketAccount};
use crate::error::LordspotError::{SlotMismatch, SeedMisMatch, UnresolvedRandomness};
use crate::utility::run_lordspot_state::{fisher_yates_draw, compute_winning_bitvec, calculate_special_marble_max, calculate_tier_winners_and_payouts};


pub fn commit_to_random_num_handler(ctx : Context<CommitToRandomNum>) -> Result<()> {
    let state = &mut ctx.accounts.global_state_account;
    let clock = Clock::get()?;

    let randomness_data = RandomnessAccountData::parse(
        ctx.accounts.switchboard_random_account.data.borrow()
    ).unwrap();

    msg!("🚀 [COMMIT] Slot: {} | SB Seed Slot: {}", clock.slot, randomness_data.seed_slot);

    (randomness_data.seed_slot != clock.slot - 1).then_some(()).ok_or(SlotMismatch)?;

    require!(randomness_data.get_value(clock.slot).is_err(), LordspotError::AlreadyRevealedRandomValue);

    state.commit_slot = randomness_data.seed_slot;
    Ok(())
}

pub fn save_random_num_handler(ctx : Context<SaveRandomNum>) -> Result<()> {
    let state = &mut ctx.accounts.global_state_account;
    let clock = Clock::get()?;

    let randomness_data = RandomnessAccountData::parse(
        ctx.accounts.switchboard_random_account.data.borrow()
    ).unwrap();

    (randomness_data.seed_slot == state.commit_slot).then_some(()).ok_or(SeedMisMatch)?;

    let revealed_random_value = randomness_data
        .get_value(clock.slot)
        .map_err(|_| UnresolvedRandomness)?;

    let val = revealed_random_value;
    state.rand_value = Some(val);

    msg!("🎯 [SAVE] Random Number Revealed: {:?}", val);
    Ok(())
}

pub fn run_jackpot_handler(ctx: Context<RunJackpot>) -> Result<()> {

    let rand_value = ctx.accounts.global_state_account.rand_value
        .ok_or(LordspotError::UnresolvedRandomness)?;

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp as u64 >= ctx.accounts.drawing_state_account.drawing_time,
        LordspotError::DrawingNotReady
    );

    require!(
        !ctx.accounts.drawing_state_account.lordspot_lock,
        LordspotError::LordspotIsLocked
    );

    let normal_marble_max  = ctx.accounts.global_state_account.normal_marble_max;
    let special_marble_max = ctx.accounts.drawing_state_account.special_marble_max;
    let total_tickets      = ctx.accounts.drawing_state_account.total_tickets;
    let epoch_id           = ctx.accounts.global_state_account.current_epoch_id;


    let normal_balls = fisher_yates_draw(
        1,
        normal_marble_max,
        5,
        rand_value,
        0,
    )?;

    let special_balls = fisher_yates_draw(
        1,
        special_marble_max,
        1,
        rand_value,
        1000,
    )?;
    let special_ball = special_balls[0];

    let (winning_normals_bitvec, winning_special_bit_pos) = compute_winning_bitvec(
        &normal_balls,
        special_ball,
        normal_marble_max,
    )?;

    // ----------------------------------------------------------
    // 7. INITIALIZE TALLY STATE
    // ----------------------------------------------------------
    let tally          = &mut ctx.accounts.tally_state;
    tally.draw_id                 = epoch_id;
    tally.winning_normals_bitvec  = winning_normals_bitvec;
    tally.winning_special_bit_pos = winning_special_bit_pos;
    tally.tier_counts             = [0u64; 12];
    tally.tier_payouts            = [0u64; 12];
    tally.user_winnings           = 0;
    tally.protocol_fee            = 0;
    tally.cursor                  = 0;
    tally.total_tickets           = total_tickets;
    tally.status                  = TallyStatus::Tallying;
    tally.bump                    = ctx.bumps.tally_state;

    // ----------------------------------------------------------
    // 8. LOCK THE PROTOCOL
    //    No ticket purchases, no LP deposits until finalizeEpoch
    // ----------------------------------------------------------
    let drawing_mut = &mut ctx.accounts.drawing_state_account;
    drawing_mut.lordspot_lock = true;

    let global_mut = &mut ctx.accounts.global_state_account;
    global_mut.allow_ticket_purchase = false;
    global_mut.rand_value            = None; // ready for next epoch's Switchboard call

    Ok(())
}

pub fn crank_tally_handler<'info>(
    ctx:        Context<'_, '_, 'info, 'info, CrankTally<'info>>,
    epoch_id:   u64,
    batch_size: u64,
) -> Result<()> {

    let tally = &ctx.accounts.tally_state;

    require!(
        tally.status == TallyStatus::Tallying,
        LordspotError::TallyAlreadySettled
    );

    // Read before mutable borrow
    let cursor         = tally.cursor;
    let total_tickets  = tally.total_tickets;
    let winning_normals = tally.winning_normals_bitvec;
    let winning_special = tally.winning_special_bit_pos as usize;

    // ----------------------------------------------------------
    // 2. COMPUTE ACTUAL BATCH SIZE
    //    Never go past total_tickets
    // ----------------------------------------------------------
    let actual_batch = batch_size.min(total_tickets - cursor) as usize;

    require!(
        ctx.remaining_accounts.len() >= actual_batch,
        LordspotError::TicketAccountMismatch
    );

    // ----------------------------------------------------------
    // 3. PROCESS EACH TICKET IN BATCH
    //    Tickets must be passed in sequential order (cursor, cursor+1, ...)
    //    Bot derives PDAs: [SEED_TICKET, epoch_bytes, index_bytes]
    //    We verify order via ticket_index field to prevent manipulation
    // ----------------------------------------------------------
    let mut tier_deltas = [0u64; 12];

    for i in 0..actual_batch {
        let ticket_info = &ctx.remaining_accounts[i];
        let ticket= Account::<TicketAccount>::try_from(ticket_info)?;

        // Verify this ticket belongs to the right epoch
        require!(
            ticket.draw_id == epoch_id,
            LordspotError::InvalidEpochId
        );

        // Verify sequential order — prevents double counting or skipping
        require!(
            ticket.ticket_index == cursor + i as u64,
            LordspotError::InvalidTicketOrder
        );

        // --- Normal ball matches via popcount ---
        let mut normal_matches: u8 = 0;
        for j in 0..32usize {
            normal_matches += (ticket.bitvec[j] & winning_normals[j]).count_ones() as u8;
        }

        // --- Special ball hit check ---
        let special_byte = winning_special / 8;
        let special_bit  = winning_special % 8;
        let bonus_hit    = (ticket.bitvec[special_byte] >> special_bit) & 1 == 1;

        // --- Tier index — same formula as EVM ---
        // tier = matches*2 + (1 if bonus_hit else 0)
        let tier = (normal_matches as usize * 2) + if bonus_hit { 1 } else { 0 };

        tier_deltas[tier] += 1;
    }

    // Apply deltas to tally
    let tally_mut = &mut ctx.accounts.tally_state;
    for i in 0..12 {
        tally_mut.tier_counts[i] = tally_mut.tier_counts[i]
            .checked_add(tier_deltas[i])
            .ok_or(LordspotError::AirthMaticOverflow)?;
    }
    tally_mut.cursor = cursor
        .checked_add(actual_batch as u64)
        .ok_or(LordspotError::AirthMaticOverflow)?;

    // ----------------------------------------------------------
    // 4. FINAL BATCH — COMPUTE PAYOUTS (EXACT SOLIDITY MATH)
    // ----------------------------------------------------------
    if tally_mut.cursor >= total_tickets {
        let normal_max = ctx.accounts.global_state_account.normal_marble_max;
        let bonus_max  = ctx.accounts.drawing_state_account.special_marble_max;
        let prize_pool = ctx.accounts.drawing_state_account.prize_pool;
        let lp_earnings = ctx.accounts.drawing_state_account.lp_earnings;
        let protocol_fee_rate = PROTOCOL_FEE;

        let ( _tier_winners, tier_payouts, _use_min, _min_alloc, total_user_winnings ) =
            calculate_tier_winners_and_payouts(
                prize_pool,
                normal_max,
                bonus_max,
                &tally_mut.tier_counts,   // real_user_tickets_per_tier
            );

        // Store per-ticket payouts (exactly what claim reads)
        tally_mut.tier_payouts = tier_payouts;

        // Protocol fee (unchanged)
        let protocol_fee = (lp_earnings as u128)
            .checked_mul(protocol_fee_rate as u128)
            .ok_or(LordspotError::AirthMaticOverflow)?
            .checked_div(PRECISE_UNIT as u128)
            .ok_or(LordspotError::AirthMaticUnderflow)? as u64;

        tally_mut.user_winnings = total_user_winnings;
        tally_mut.protocol_fee  = protocol_fee;
        tally_mut.status        = TallyStatus::Settled;
    }

    Ok(())

}

pub fn finalize_epoch_handler(ctx: Context<FinalizeEpoch>) -> Result<()> {

    // ----------------------------------------------------------
    // 1. VERIFY CRANK IS DONE
    // ----------------------------------------------------------
    require!(
        ctx.accounts.tally_state.status == TallyStatus::Settled,
        LordspotError::TallyNotSettled
    );

    // Read everything before mutable borrows
    let user_winnings     = ctx.accounts.tally_state.user_winnings;
    let protocol_fee      = ctx.accounts.tally_state.protocol_fee;
    let lp_earnings       = ctx.accounts.drawing_state_account.lp_earnings;
    let lp_pool_total     = ctx.accounts.epoch_to_lp_drawing_state.lp_pool_total;
    let pending_deposits  = ctx.accounts.epoch_to_lp_drawing_state.pending_deposits;
    let drawing_time      = ctx.accounts.drawing_state_account.drawing_time;

    let global = &ctx.accounts.global_state_account;
    let lp_edge_target    = global.lp_target_percent;
    let ticket_price      = global.ticket_price;
    let normal_marble_max = global.normal_marble_max;
    let special_marble_min      = global.special_ball_min;
    let special_marble_hard_cap = global.special_ball_hard_cap;
    let drawing_duration  = global.drawing_duration;
    let current_epoch_id  = global.current_epoch_id;

    // ----------------------------------------------------------
    // 2. COMPUTE POST-DRAW LP VALUE
    //    postDrawLpValue = lp_pool_total + lp_earnings - userWinnings - protocolFee
    // ----------------------------------------------------------
    let post_draw_lp_value = lp_pool_total
        .checked_add(lp_earnings)
        .ok_or(LordspotError::AirthMaticOverflow)?
        .checked_sub(user_winnings)
        .ok_or(LordspotError::AirthMaticUnderflow)?
        .checked_sub(protocol_fee)
        .ok_or(LordspotError::AirthMaticUnderflow)?;

    // ----------------------------------------------------------
    // 3. PENDING DEPOSITS ACTIVATE NOW
    //    LPs who deposited during epoch N → active in epoch N+1
    // ----------------------------------------------------------
    let new_lp_pool_total = post_draw_lp_value
        .checked_add(pending_deposits)
        .ok_or(LordspotError::AirthMaticOverflow)?;

    // reserveRatio = 0 → newPrizePool = newLpPoolTotal
    let new_prize_pool = new_lp_pool_total;

    // ----------------------------------------------------------
    // 4. CALCULATE NEW SPECIAL MARBLE MAX
    //    Dynamic — grows with prize pool, capped at hard cap
    // ----------------------------------------------------------
    let new_special_marble_max = calculate_special_marble_max(
        new_prize_pool,
        lp_edge_target,
        ticket_price,
        normal_marble_max,
        special_marble_min,
        special_marble_hard_cap,
    )?;

    let new_epoch_id = current_epoch_id
        .checked_add(1)
        .ok_or(LordspotError::AirthMaticOverflow)?;

    // ----------------------------------------------------------
    // 5. INITIALIZE NEW DRAWING STATE (epoch N+1)
    // ----------------------------------------------------------
    let new_drawing          = &mut ctx.accounts.new_drawing_state;
    new_drawing.prize_pool        = new_prize_pool;
    new_drawing.total_tickets     = 0;
    new_drawing.lp_earnings       = 0;
    new_drawing.special_marble_max = new_special_marble_max;
    new_drawing.lordspot_lock     = false;
    new_drawing.drawing_time      = drawing_time
        .checked_add(drawing_duration)
        .ok_or(LordspotError::AirthMaticOverflow)?;
    new_drawing.bump              = ctx.bumps.new_drawing_state;

    // ----------------------------------------------------------
    // 6. INITIALIZE NEW LP STATE (epoch N+1)
    //    pending_deposits = 0 — fresh start for new epoch
    // ----------------------------------------------------------
    let new_lp_state= &mut ctx.accounts.new_epoch_to_lp_drawing_state;
    new_lp_state.lp_pool_total         = new_lp_pool_total;
    new_lp_state.pending_deposits      = 0;
    new_lp_state.pending_withdrawals   = 0;
    new_lp_state.bump                  = ctx.bumps.new_epoch_to_lp_drawing_state;

    // ----------------------------------------------------------
    // 7. UPDATE GLOBAL STATE — UNLOCK PROTOCOL
    // ----------------------------------------------------------
    let global_mut = &mut ctx.accounts.global_state_account;
    global_mut.current_epoch_id      = new_epoch_id;
    global_mut.allow_ticket_purchase = true;

    Ok(())
}

#[derive(Accounts)]
pub struct CommitToRandomNum<'info>{
    #[account(mut,  address = ADMIN_PUBKEY @ LordspotError::InvalidOwner)]
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
}

#[derive(Accounts)]
pub struct RunJackpot<'info> {

    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_GLOBAL],
        bump = global_state_account.bump,
    )]
    pub global_state_account: Account<'info, GlobalState>,

    #[account(
        mut,
        seeds = [
            SEED_DRAWING_STATE,
            global_state_account.current_epoch_id.to_le_bytes().as_ref(),
        ],
        bump = drawing_state_account.bump,
        constraint = !drawing_state_account.lordspot_lock
            @ LordspotError::LordspotIsLocked,
    )]
    pub drawing_state_account: Account<'info, DrawingState>,

    #[account(
        seeds = [
            SEED_LP_DRAWING_STATE,
            global_state_account.current_epoch_id.to_le_bytes().as_ref(),
        ],
        bump = epoch_to_lp_drawing_state.bump,
    )]
    pub epoch_to_lp_drawing_state: Account<'info, EpochIdToLPDrawingState>,

    #[account(
        init,
        payer = signer,
        space = TallyState::LEN,
        seeds = [
            SEED_TALLY,
            global_state_account.current_epoch_id.to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub tally_state: Account<'info, TallyState>,

    pub system_program: Program<'info, System>
}

#[derive(Accounts)]
#[instruction(epoch_id: u64)]
pub struct CrankTally<'info> {

    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        seeds = [SEED_GLOBAL],
        bump = global_state_account.bump,
    )]
    pub global_state_account: Account<'info, GlobalState>,

    #[account(
        seeds = [
            SEED_DRAWING_STATE,
            epoch_id.to_le_bytes().as_ref(),
        ],
        bump = drawing_state_account.bump,
    )]
    pub drawing_state_account: Account<'info, DrawingState>,

    #[account(
        mut,
        seeds = [SEED_TALLY, epoch_id.to_le_bytes().as_ref()],
        bump = tally_state.bump,
        constraint = tally_state.draw_id == epoch_id
            @ LordspotError::InvalidEpochId,
    )]
    pub tally_state: Account<'info, TallyState>,

}

#[derive(Accounts)]
pub struct FinalizeEpoch<'info> {

    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_GLOBAL],
        bump = global_state_account.bump,
    )]
    pub global_state_account: Account<'info, GlobalState>,

    #[account(
        seeds = [
            SEED_DRAWING_STATE,
            global_state_account.current_epoch_id.to_le_bytes().as_ref(),
        ],
        bump = drawing_state_account.bump,
    )]
    pub drawing_state_account: Account<'info, DrawingState>,

    #[account(
        seeds = [
            SEED_LP_DRAWING_STATE,
            global_state_account.current_epoch_id.to_le_bytes().as_ref(),
        ],
        bump = epoch_to_lp_drawing_state.bump,
    )]
    pub epoch_to_lp_drawing_state: Account<'info, EpochIdToLPDrawingState>,


    #[account(
        seeds = [
            SEED_TALLY,
            global_state_account.current_epoch_id.to_le_bytes().as_ref(),
        ],
        bump = tally_state.bump,
        constraint = tally_state.status == TallyStatus::Settled
            @ LordspotError::TallyNotSettled,
    )]
    pub tally_state: Account<'info, TallyState>,


    #[account(
        init,
        payer = signer,
        space = 8 + DrawingState::INIT_SPACE,
        seeds = [
            SEED_DRAWING_STATE,
            (global_state_account.current_epoch_id + 1).to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub new_drawing_state: Account<'info, DrawingState>,

    // Epoch N+1 LP state — created here
    #[account(
        init,
        payer = signer,
        space = 8 + EpochIdToLPDrawingState::INIT_SPACE,
        seeds = [
            SEED_LP_DRAWING_STATE,
            (global_state_account.current_epoch_id + 1).to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub new_epoch_to_lp_drawing_state: Account<'info, EpochIdToLPDrawingState>,

    pub system_program: Program<'info, System>,
}

