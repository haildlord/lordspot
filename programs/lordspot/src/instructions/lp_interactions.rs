use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenInterface, TokenAccount, TransferChecked, transfer_checked};
use crate::constants::{USDC_DEVNET_ADDRESS, SEED_GLOBAL, SEED_PROTOCOL_USDC_ACCOUNT};
use crate::error::LordspotError;
use crate::state::GlobalState;


pub fn lp_deposit(ctx : Context<LpDeposit>, amount : u64) -> Result<()> {

    require!(amount > 0, LordspotError::AmountCannotBeZero);

    let cpi_context = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            from : ctx.accounts.lp_mint_account.to_account_info(),
            to : ctx.accounts.protocol_usdc_vault.to_account_info(),
            mint : ctx.accounts.usdc_mint.to_account_info(),
            authority : ctx.accounts.signer.to_account_info(),
        },
    );

    transfer_checked(cpi_context, amount, ctx.accounts.usdc_mint.decimals)?;

    Ok(())
}


#[derive(Accounts)]
pub struct LpDeposit<'info>{

    #[account(mut)]
    pub signer : Signer<'info>,

    #[account(
        address = USDC_DEVNET_ADDRESS @ LordspotError::InvalidMintAddress
    )]
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [SEED_GLOBAL],
        bump = global_state_account.bump
    )]
    pub global_state_account: Account<'info, GlobalState>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = signer,
        associated_token::token_program = token_program
    )]
    pub lp_mint_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [SEED_PROTOCOL_USDC_ACCOUNT],
        bump,
        token::mint = usdc_mint,
        token::authority = global_state_account,
    )]
    pub protocol_usdc_vault : InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program : Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

