use anchor_lang::prelude::*;
use crate::constants::PRECISE_UNIT;
use crate::error::LordspotError;
use crate::state::{EpochIdToLPDrawingState, GlobalState, LPInfo, PerEpochState};
use crate::utility::main::calculate_next_drawing_lp_pool;

// # lp_deposit()
pub fn _consolidate_deposits(
    lp_info: &mut Account<LPInfo>,
    deposit_epoch_state: &Account<PerEpochState>,   // historical epoch for the deposit
    current_epoch_id: u64,
) -> Result<()> {

    let last = lp_info.last_deposit_info;   // Copy (DepositInfo is small + Copy)

    if last.amount > 0 && last.epoch_id < current_epoch_id {

        let shares_to_add = (last.amount as u128)
            .checked_mul(PRECISE_UNIT as u128)
            .ok_or(LordspotError::AirthMaticOverflow)?
            .checked_div(deposit_epoch_state.shares_percentage as u128)
            .ok_or(LordspotError::AirthMaticUnderflow)?;

        // Now safely update consolidated_shares
        lp_info.consolidated_shares = (lp_info.consolidated_shares as u128)
            .checked_add(shares_to_add)
            .ok_or(LordspotError::AirthMaticOverflow)? as u64;

        // Clear lastDeposit
        lp_info.last_deposit_info.amount = 0;
        lp_info.last_deposit_info.epoch_id = 0;
    }

    Ok(())
}

// # lp_deposit()
pub fn process_deposit<'info>(
    global_state: &Account<GlobalState>,
    epoch_to_lp: &mut Account<EpochIdToLPDrawingState>,
    lp_info: &mut Account<LPInfo>,
    deposit_epoch_state: &Account<PerEpochState>,   // historical for consolidation
    prev_epoch_state: &Option<Account<'info, PerEpochState>>,
    amount: u64
) -> Result<()> {

    // Calculate pending withdrawals in USDC
    let pending_withdrawals_in_usdc: u64 = if global_state.current_epoch_id == 0 {
        0
    } else {
        let prev = prev_epoch_state.as_ref().ok_or(LordspotError::MissingPreviousEpochAccount)?;

        (epoch_to_lp.pending_withdrawals as u128)
            .checked_mul(prev.shares_percentage as u128)
            .ok_or(LordspotError::AirthMaticOverflow)?
            .checked_div(PRECISE_UNIT as u128)
            .ok_or(LordspotError::AirthMaticUnderflow)? as u64
    };

    // Cap check (full Solidity logic)
    let next_drawing_lp_pool = calculate_next_drawing_lp_pool(
        epoch_to_lp.lp_pool_total,
        epoch_to_lp.pending_deposits,
        pending_withdrawals_in_usdc,
    )?
        .checked_add(amount)
        .ok_or(LordspotError::AirthMaticOverflow)?;

    require!(next_drawing_lp_pool <= global_state.lp_pool_cap, LordspotError::ExceedsPoolCap);

    // Consolidate previous deposit using historical epoch state
    _consolidate_deposits(lp_info, deposit_epoch_state, global_state.current_epoch_id)?;

    // Add new deposit
    lp_info.last_deposit_info.amount = (lp_info.last_deposit_info.amount as u128)
        .checked_add(amount as u128)
        .ok_or(LordspotError::AirthMaticOverflow)? as u64;

    lp_info.last_deposit_info.epoch_id = global_state.current_epoch_id;

    epoch_to_lp.pending_deposits = epoch_to_lp.pending_deposits
        .checked_add(amount)
        .ok_or(LordspotError::AirthMaticOverflow)?;

    Ok(())
}