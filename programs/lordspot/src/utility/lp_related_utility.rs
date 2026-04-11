use anchor_lang::prelude::*;
use crate::constants::PRECISE_UNIT;
use crate::error::LordspotError;
use crate::state::{EpochIdToLPDrawingState, GlobalState, LPInfo, PerEpochState};

pub fn _consolidate_deposits(per_epoch_state_account : &mut Account<LPInfo>, _per_epoch_state_account : &Account<PerEpochState>, _epoch_id : u64) -> Result<()> {

    if(per_epoch_state_account.last_deposit_info.amount > 0 && per_epoch_state_account.last_deposit_info.epoch_id < _epoch_id){

        let numerator = (per_epoch_state_account.last_deposit_info.amount as u128).checked_mul(PRECISE_UNIT as u128).ok_or(LordspotError::AirthMaticOverflow)?;
        let shares_to_add = numerator.checked_div(_per_epoch_state_account.shares_percentage as u128).ok_or(LordspotError::AirthMaticUnderflow)?;

        per_epoch_state_account.consolidated_shares = (per_epoch_state_account.consolidated_shares as u128)
            .checked_add(shares_to_add)
            .ok_or(LordspotError::AirthMaticOverflow)? as u64;

        per_epoch_state_account.last_deposit_info.amount = 0;
        per_epoch_state_account.last_deposit_info.epoch_id = 0;

    }

    Ok(())
}

// # lp_deposit()
pub fn process_deposit(global_state : &Account<GlobalState>, epoch_to_lp_drawingstate : &mut Account<EpochIdToLPDrawingState>, lp_info_account : &mut Account<LPInfo>, per_epoch_state_account : &Account<PerEpochState>, _amount : u64) -> Result<()> {

    let total_pool_values : u64 = epoch_to_lp_drawingstate.lp_pool_total.checked_add(epoch_to_lp_drawingstate.pending_deposits).and_then(|sum| sum.checked_add(_amount)).ok_or(LordspotError::AirthMaticOverflow)?;

    require!(total_pool_values <= global_state.lp_pool_cap, LordspotError::ExceedsPoolCap);

    _consolidate_deposits(lp_info_account, per_epoch_state_account, global_state.current_epoch_id)?;

    lp_info_account.last_deposit_info.amount = (lp_info_account.last_deposit_info.amount as u128).checked_add(_amount as u128).ok_or(LordspotError::AirthMaticOverflow)? as u64;
    lp_info_account.last_deposit_info.epoch_id = global_state.current_epoch_id;

    epoch_to_lp_drawingstate.pending_deposits = epoch_to_lp_drawingstate.pending_deposits
        .checked_add(_amount)
        .ok_or(LordspotError::AirthMaticOverflow)?;

    Ok(())
}