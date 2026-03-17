use anchor_lang::prelude::*;
use crate::constants::ADMIN_PUBKEY;
use crate::state::GlobalState;
use crate::error::ErrorCode;

pub fn handler(ctx: Context<Initialize>, rngkp : Pubkey) -> Result<()> {
    let state = &mut ctx.accounts.global_state_account;

    state.switchboard_random_account = rngkp;
    state.rand_value = None;
    state.bump = ctx.bumps.global_state_account;

    msg!("✅ [INITIALIZE] PDA created at: {:?}", state.key());
    msg!("✅ [INITIALIZE] Linked to Switchboard account: {:?}", state.switchboard_random_account);
    Ok(())
}

pub fn close_handler(_ctx: Context<CloseState>) -> Result<()> {
    msg!("💀 [CLOSE] State deleted. SOL returned to Admin.");
    Ok(())
}


#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        mut,
        address = ADMIN_PUBKEY.parse::<Pubkey>().unwrap()
    )]
    pub signer : Signer<'info>,
    #[account(
        init,
        payer = signer,
        space = 8 + GlobalState::INIT_SPACE,
        seeds = [b"global_state_account"],
        bump
    )]
    pub global_state_account: Account<'info, GlobalState>,
    pub system_program : Program<'info, System>,
}


#[derive(Accounts)]
pub struct CloseState<'info> {
    #[account(
        mut,
        close = signer,
        seeds = [b"global_state_account"],
        bump = global_state_account.bump,
        constraint = signer.key() == ADMIN_PUBKEY.parse::<Pubkey>().unwrap() @ ErrorCode::Unauthorized
    )]
    pub global_state_account: Account<'info, GlobalState>,
    #[account(mut)]
    pub signer: Signer<'info>,
}

