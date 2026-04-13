use anchor_lang::prelude::*;
use crate::utility::combinations::choose;
use crate::constants::{NORMAL_SELECTABLE_MARBLE_COUNT, PRECISE_UNIT};
use crate::error::LordspotError;
use crate::state::{DrawingState, EpochIdToLPDrawingState, GlobalState, PerEpochState};


/// Exactly matches Solidity _calculateNextDrawingLpPool
// # lp_deposit()
pub fn calculate_next_drawing_lp_pool(
    lp_pool_total: u64,
    pending_deposits: u64,
    pending_withdrawals_in_usdc: u64,
) -> Result<u64> {
    lp_pool_total
        .checked_add(pending_deposits)
        .and_then(|sum| sum.checked_sub(pending_withdrawals_in_usdc))
        .ok_or(Error::from(ProgramError::ArithmeticOverflow))
}


// # handler()
pub fn calculate_edge_per_ticket(
    lp_target_percent: u64,
    ticket_price: u64,
) -> Result<u64> {
    Ok(
        (lp_target_percent as u128)
            .checked_mul(ticket_price as u128)
            .ok_or(LordspotError::AirthMaticOverflow)?
            .checked_div(PRECISE_UNIT as u128)
            .ok_or(LordspotError::AirthMaticUnderflow)? as u64
    )
}

// # handler()
pub fn initialize_global_config(
    global: &mut GlobalState,
    rngkp: Pubkey,
    normal_marble_max: u8,
    pool_total_cap: u64,
    ticket_price: u64,
    lp_target_percent: u64,
    special_ball_min: u8,
    special_ball_soft_cap: u8,
    special_ball_hard_cap: u8,
    protocol_fee: u64,
    protocol_fee_threshold: u64,
    global_bump: u8,
    protocol_usdc_vault_bump: u8,
) -> Result<()> {
    // Bumps
    global.bump = global_bump;
    global.protocol_usdc_vault_bump = protocol_usdc_vault_bump;

    // Switchboard
    global.switchboard_random_account = rngkp;

    // Core config
    global.pool_total_cap = pool_total_cap;
    global.current_epoch_id = 0;
    global.normal_marble_max = normal_marble_max;
    global.ticket_price = ticket_price;
    global.lp_target_percent = lp_target_percent;

    // Edge calculation
    global.edge_per_ticket = calculate_edge_per_ticket(lp_target_percent, ticket_price)?;

    // Special ball config
    global.special_ball_min = special_ball_min;
    global.special_ball_soft_cap = special_ball_soft_cap;
    global.special_ball_hard_cap = special_ball_hard_cap;

    // Protocol fee config
    global.protocol_fee = protocol_fee;
    global.protocol_fee_threshold = protocol_fee_threshold;

    Ok(())
}

// # handler()
pub fn initialize_epoch_state(
    epoch_state: &mut PerEpochState,
    bump: u8,
) -> Result<()> {
    epoch_state.epoch_id = 0;
    epoch_state.shares_percentage = PRECISE_UNIT;
    epoch_state.bump = bump;
    Ok(())
}

// # handler()
pub fn set_lp_pool_cap(
    state_lp_pool_cap: &mut u64,           // global.lp_pool_cap
    lp_soft_cap: u64,                      // theoretical soft cap (65-based)
    lp_pool_total: u64,
    pending_deposits: u64,
    pending_withdrawals_in_usdc: u64,      // ← NEW: 0 for init & epoch 0
    calc_lp_pool_cap: u64,                 // governance cap after min()
) -> Result<()> {

    let next_drawing_lp_pool = calculate_next_drawing_lp_pool(
        lp_pool_total,
        pending_deposits,
        pending_withdrawals_in_usdc,
    )?;

    // Soft-cap safety (this was the missing piece)
    require!(
        lp_soft_cap > next_drawing_lp_pool,
        LordspotError::InvalidLPSoftCap
    );

    // Governance cap safety
    require!(
        calc_lp_pool_cap >= next_drawing_lp_pool,
        LordspotError::InvalidLPPoolCap
    );

    *state_lp_pool_cap = calc_lp_pool_cap;

    Ok(())
}

// # handler()
// =============================================================
// 1. calculate_lp_pool_soft_cap  (already good — just added comment)
pub fn calculate_lp_pool_soft_cap(
    normal_marble_max: u8,
    ticket_price: u64,
    lp_target_percent: u64,
    bonusball_soft_cap: u8,
) -> Result<u64> {
    let combos = choose(normal_marble_max as u64, NORMAL_SELECTABLE_MARBLE_COUNT as u64)
        .ok_or(LordspotError::InvalidMarbleConfiguration)?;

    let max_tickets = combos
        .checked_mul(bonusball_soft_cap as u64)
        .ok_or(LordspotError::AirthMaticOverflow)?;

    let max_prize = max_tickets
        .checked_mul(ticket_price)
        .ok_or(LordspotError::AirthMaticOverflow)?
        .checked_mul(PRECISE_UNIT - lp_target_percent)
        .ok_or(LordspotError::AirthMaticOverflow)?
        .checked_div(PRECISE_UNIT)
        .ok_or(LordspotError::AirthMaticUnderflow)?;

    Ok(max_prize)
}

// # handler()
pub fn initialize_lp_pool_cap(
    global: &mut GlobalState,
    lp_state: &mut EpochIdToLPDrawingState,
    normal_marble_max: u8,
    ticket_price: u64,
    lp_target_percent: u64,
    special_ball_soft_cap: u8,
    pool_total_cap: u64,
) -> Result<()> {

    let soft_cap = calculate_lp_pool_soft_cap(
        normal_marble_max,
        ticket_price,
        lp_target_percent,
        special_ball_soft_cap,
    )?;

    let final_cap = soft_cap.min(pool_total_cap);

    // For initialization → withdrawalsInUSDC = 0
    set_lp_pool_cap(
        &mut global.lp_pool_cap,
        soft_cap,
        lp_state.lp_pool_total,
        lp_state.pending_deposits,
        0,
        final_cap,
    )?;

    Ok(())
}








pub fn process_drawing_settlement(_global_state_account : &Account<GlobalState> , _epoch_id_to_lp_drawing_state: &Account<EpochIdToLPDrawingState>, _drawing_state_account : &Account<DrawingState>, _per_epoch_state_account : &mut Account<PerEpochState>, _prev_per_epoch_state_account : &Option<Account<PerEpochState>>, _user_winnings : u64, _protocol_fee_amount : u64) -> Result<(u64, u64)> {

    let post_draw_lp_value = _epoch_id_to_lp_drawing_state.lp_pool_total.checked_add(_drawing_state_account.lp_earnings).and_then(|sum| sum.checked_sub(_user_winnings)).and_then(|value| value.checked_sub(_protocol_fee_amount)).ok_or(LordspotError::AirthMaticOverflow)?;

    let mut new_accumulator : u64 = 0;

    if _global_state_account.current_epoch_id > 0 {
        new_accumulator =
            if _epoch_id_to_lp_drawing_state.lp_pool_total == 0 { PRECISE_UNIT }
            else {
                let prev_epoch = _prev_per_epoch_state_account.as_ref().ok_or(LordspotError::MissingPreviousEpochAccount)?;
                (prev_epoch.shares_percentage as u128).checked_mul(post_draw_lp_value as u128).and_then(|prod| prod.checked_div(_epoch_id_to_lp_drawing_state.lp_pool_total as u128)).ok_or(LordspotError::AirthMaticUnderflow)? as u64
            };

        _per_epoch_state_account.shares_percentage = new_accumulator;
    }

    let withdrawals_in_usdc = (_epoch_id_to_lp_drawing_state.pending_withdrawals as u128).checked_mul(new_accumulator as u128).and_then(|prod| prod.checked_div(PRECISE_UNIT as u128)).ok_or(LordspotError::AirthMaticUnderflow)? as u64;
    let new_lp_value = post_draw_lp_value.checked_add(_epoch_id_to_lp_drawing_state.pending_deposits).and_then(|sum| sum.checked_sub(withdrawals_in_usdc)).ok_or(LordspotError::AirthMaticOverflow)?;
    Ok((new_lp_value,new_accumulator))
}

pub fn _set_new_drawing_state( global_state_account : &mut Account<GlobalState>, next_drawing_id_to_lp_drawing_state : &mut Account<EpochIdToLPDrawingState>, drawing_state_account : &mut Account<DrawingState>, new_lp_value : u64, ini_drawing_time : u64) -> Result<()> {

    global_state_account.current_epoch_id = global_state_account.current_epoch_id
        .checked_add(1)
        .ok_or(LordspotError::AirthMaticOverflow)?;

    next_drawing_id_to_lp_drawing_state.lp_pool_total = new_lp_value;
    next_drawing_id_to_lp_drawing_state.pending_deposits = 0;
    next_drawing_id_to_lp_drawing_state.pending_withdrawals = 0;

    let new_prize_pool = (new_lp_value as u128).checked_div(PRECISE_UNIT as u128).ok_or(LordspotError::AirthMaticOverflow)? as u64;
    drawing_state_account.prize_pool = new_prize_pool;

    drawing_state_account.total_tickets = 0;
    drawing_state_account.lp_earnings = 0;
    drawing_state_account.drawing_time = ini_drawing_time;
    drawing_state_account.lordspot_lock = false;

    let combo_per_bonus_ball = choose(global_state_account.normal_marble_max as u64, NORMAL_SELECTABLE_MARBLE_COUNT as u64).ok_or(LordspotError::InvalidMarbleConfiguration)?;;

    let numerator = (new_prize_pool as u128).checked_mul(PRECISE_UNIT as u128).ok_or(LordspotError::AirthMaticOverflow)?;
    let denominator = (PRECISE_UNIT as u128).checked_sub(global_state_account.lp_target_percent as u128).and_then(|prod| prod.checked_mul(global_state_account.ticket_price as u128)).ok_or(LordspotError::AirthMaticOverflow)?;
    let min_number_tickets = numerator.checked_div(denominator).ok_or(LordspotError::AirthMaticUnderflow)? as u64;

    let ceil_div = (min_number_tickets as u128)
        .checked_add(combo_per_bonus_ball as u128)
        .and_then(|sum| sum.checked_sub(1))
        .and_then(|val| val.checked_div(combo_per_bonus_ball as u128))
        .ok_or(LordspotError::AirthMaticOverflow)? as u64;

    let new_bonus_ball= std::cmp::max(global_state_account.special_ball_min as u64, ceil_div) as u8;
    drawing_state_account.special_marble_max = new_bonus_ball;

    Ok(())
}

