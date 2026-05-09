use anchor_lang::prelude::*;
use crate::error::LordspotError;
use crate::state::{EpochIdToLPDrawingState, GlobalState, LPInfo, PerEpochState};
pub(crate) use crate::utility::main::calculate_next_drawing_lp_pool;

// # lp_deposit()
pub fn _consolidate_deposits<'info>(
    lp_info: &mut Account<LPInfo>,
    deposit_epoch_state_opt: &Option<Account<'info, PerEpochState>>, // # deposit_epoch_state_opt : is user when last_deposited's epoch shares_percentage
    current_epoch_id: u64,
) -> Result<()> {

    let last = lp_info.last_deposit_info;

    if last.amount > 0 && last.epoch_id < current_epoch_id {
        // SECURITY CHECK: If they have a past deposit, FORCE them to have provided the account
        let deposit_epoch_state = deposit_epoch_state_opt.as_ref()
            .ok_or(LordspotError::MissingHistoricalEpochAccount)?; // Make sure to add this error!

        let shares_to_add = (last.amount as u128)
            .checked_mul(crate::PRECISE_UNIT as u128)
            .ok_or(LordspotError::AirthMaticOverflow)?
            .checked_div(deposit_epoch_state.shares_percentage as u128)
            .ok_or(LordspotError::AirthMaticUnderflow)?;

        // Safely update consolidated_shares
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
    epoch_to_lp: &mut Account<EpochIdToLPDrawingState>, // # currentEpoch : (lp_pool_total, pending_deposits, pending_withdrawals)
    lp_info: &mut Account<LPInfo>,
    deposit_epoch_state: &Option<Account<'info, PerEpochState>>, // # deposit_epoch_state : is user when last_deposited's epoch shares_percentage
    prev_epoch_state: &Option<Account<'info, PerEpochState>>, // # prev_epoch_state : shares_percentage of C - 1
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
            .checked_div(crate::PRECISE_UNIT as u128)
            .ok_or(LordspotError::AirthMaticUnderflow)? as u64
    };

    // Cap check
    let next_drawing_lp_pool = calculate_next_drawing_lp_pool(
        epoch_to_lp.lp_pool_total,
        epoch_to_lp.pending_deposits,
        pending_withdrawals_in_usdc,
    )?
        .checked_add(amount)
        .ok_or(LordspotError::AirthMaticOverflow)?;

    require!(next_drawing_lp_pool <= global_state.lp_pool_cap, LordspotError::ExceedsPoolCap);

    // # deposit_epoch_state is user when last_deposited's epoch shares_percentage
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


// FIX: Secure optional logic for withdrawals too
pub fn _consolidate_withdrawals<'info>(
    lp_info: &mut Account<LPInfo>,
    withdrawal_epoch_state_opt: &Option<Account<'info, PerEpochState>>,
    current_epoch_id: u64,
) -> Result<()> {

    let last = lp_info.withdrawal_info;

    if last.amount_in_shares > 0 && last.epoch_id < current_epoch_id {
        // SECURITY CHECK
        let withdrawal_epoch_state = withdrawal_epoch_state_opt.as_ref()
            .ok_or(LordspotError::MissingHistoricalEpochAccount)?;

        let usdc_to_add = (last.amount_in_shares as u128)
            .checked_mul(withdrawal_epoch_state.shares_percentage as u128)
            .ok_or(LordspotError::AirthMaticOverflow)?
            .checked_div(crate::PRECISE_UNIT as u128)
            .ok_or(LordspotError::AirthMaticUnderflow)?;

        lp_info.claimable_withdrawals = (lp_info.claimable_withdrawals as u128)
            .checked_add(usdc_to_add)
            .ok_or(LordspotError::AirthMaticOverflow)? as u64;

        // Clear withdrawal info
        lp_info.withdrawal_info.amount_in_shares = 0;
        lp_info.withdrawal_info.epoch_id = 0;
    }

    Ok(())
}