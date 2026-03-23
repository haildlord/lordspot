use anchor_lang::prelude::*;
use crate::utility::combinations::choose;
use crate::constants::{NORMAL_SELECTABLE_MARBLE_COUNT, MAX_MARBLE_RANGE_COUNT, PRECISE_UNIT};
use crate::error::LordspotError;

pub fn calculate_lp_pool_cap(
    normal_marble_max: u8,
    ticket_price: u64,
    lp_target_percent: u64,
    reserve_percent: u64,
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
        .checked_mul(PRECISE_UNIT as u128)?
        .checked_div(
            (PRECISE_UNIT as u128).checked_sub(reserve_percent as u128)?
        )?;

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

