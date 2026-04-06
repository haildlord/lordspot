use anchor_lang::prelude::*;
use crate::utility::combinations::choose;
use crate::constants::{NORMAL_SELECTABLE_MARBLE_COUNT, MAX_MARBLE_RANGE_COUNT, PRECISE_UNIT};
use crate::error::LordspotError;
use crate::state::{DrawingState, EpochIdToLPDrawingState, GlobalState, PerEpochState};

pub fn calculate_lp_pool_cap(
    normal_marble_max: u8,
    ticket_price: u64,
    lp_target_percent: u64,
    governance_pool_cap: u64
) -> Option<u64> {
    // 1. choosing NORMAL_SELECTABLE_MARBLE_COUNT from total allowed
    let total_main_combo = choose(normal_marble_max as u64, NORMAL_SELECTABLE_MARBLE_COUNT as u64)?;

    // 2. Calc Maximum Possible Special Marbles
    let total_special_options = (MAX_MARBLE_RANGE_COUNT as u64).checked_sub(normal_marble_max as u64)?;

    // 3. Calc total Combo Possible -- order does not matter
    let total_combo = total_main_combo.checked_mul(total_special_options)?;

    // 4. Revenue if each combo sold for ticket_price
    let revenue_u128 = (total_combo as u128).checked_mul(ticket_price as u128)?;

    // 5. Net Revenue :- Revenue generated reduced such that of Revenue lp_target_percent goes to the Liquidity Provider
    let net_revenue_u128 = revenue_u128
        .checked_mul(PRECISE_UNIT.checked_sub(lp_target_percent)? as u128)?
        .checked_div(PRECISE_UNIT as u128)?;

    // 6. Extrapolate Prize Pool based on Reserve Ratio : adding the netRveneue such that reserves are also extrapolated
    let calculated_prize_pool = net_revenue_u128
        .checked_mul(PRECISE_UNIT as u128)?;

    // 7. THE MIN LOGIC
    // Compare our mathematical max against the hard governance limit
    let final_cap = (calculated_prize_pool as u64).min(governance_pool_cap);

    Some(final_cap)
}

pub fn set_lp_pool_cap(state_lp_pool_cap: &mut u64, pending_deposits : u64, lp_pool_total : u64, calc_lp_pool_cap : u64) -> Result<()> {

    let particular_epoch_total_cap = lp_pool_total.checked_add(pending_deposits).ok_or(ProgramError::ArithmeticOverflow)?;
    require!(
        calc_lp_pool_cap >= particular_epoch_total_cap,
        LordspotError::InvalidLPPoolCap
    );
    *state_lp_pool_cap = calc_lp_pool_cap;

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

