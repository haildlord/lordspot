use anchor_lang::prelude::*;
use crate::constants::ADMIN_PUBKEY;
use switchboard_on_demand::accounts::RandomnessAccountData;
use crate::state::GlobalState;
use crate::error::ErrorCode;

pub fn commit_to_random_num_handler(ctx : Context<CommitToRandomNum>) -> Result<()> {
    let state = &mut ctx.accounts.global_state_account;
    let clock = Clock::get()?;

    let randomness_data = RandomnessAccountData::parse(
        ctx.accounts.switchboard_random_account.data.borrow()
    ).unwrap();

    msg!("🚀 [COMMIT] Slot: {} | SB Seed Slot: {}", clock.slot, randomness_data.seed_slot);

    if randomness_data.seed_slot != clock.slot - 1 {
        msg!("❌ ERROR: Slot mismatch (expired)");
        return Err(ErrorCode::RandomnessExpired.into());
    }

    if !randomness_data.get_value(clock.slot).is_err() {
        msg!("❌ ERROR: Already revealed");
        return Err(ErrorCode::RandomnessAlreadyRevealed.into());
    }

    state.commit_slot = randomness_data.seed_slot;
    Ok(())
}

pub fn save_random_num_handler(ctx : Context<SaveRandomNum>) -> Result<()> {
    let state = &mut ctx.accounts.global_state_account;
    let clock = Clock::get()?;

    let randomness_data = RandomnessAccountData::parse(
        ctx.accounts.switchboard_random_account.data.borrow()
    ).unwrap();

    if randomness_data.seed_slot != state.commit_slot {
        msg!("❌ ERROR: Seed mismatch");
        return Err(ErrorCode::RandomnessMismatch.into());
    }

    let revealed_random_value = randomness_data
        .get_value(clock.slot)
        .map_err(|_| ErrorCode::RandomnessNotResolved)?;

    let val = revealed_random_value[0] as u32;
    state.rand_value = Some(val);

    msg!("🎯 [SAVE] Random Number Revealed: {}", val);
    Ok(())
}


#[derive(Accounts)]
pub struct CommitToRandomNum<'info>{
    #[account(mut, address = ADMIN_PUBKEY.parse::<Pubkey>().unwrap())]
    pub signer : Signer<'info>,
    #[account(
        mut,
        has_one = switchboard_random_account,
        seeds = [b"global_state_account"],
        bump = global_state_account.bump
    )]
    pub global_state_account: Account<'info, GlobalState>,

    /// CHECK : above has_one makes sure its the right one
    pub switchboard_random_account: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct SaveRandomNum<'info>{
    #[account(mut, address = ADMIN_PUBKEY.parse::<Pubkey>().unwrap())]
    pub signer : Signer<'info>,
    #[account(
        mut,
        has_one = switchboard_random_account,
        seeds = [b"global_state_account"],
        bump = global_state_account.bump
    )]
    pub global_state_account: Account<'info, GlobalState>,

    /// CHECK : above has_one makes sure its the right one
    pub switchboard_random_account: AccountInfo<'info>,
}

