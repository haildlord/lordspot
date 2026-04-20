use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenInterface, TokenAccount, TransferChecked, transfer_checked};
use crate::constants::{MOCK_USDC_DEVNET_ADDRESS, SEED_GLOBAL, SEED_PROTOCOL_USDC_ACCOUNT, SEED_LP_INFO, SEED_LP_DRAWING_STATE, SEED_PER_EPOCH, SEED_DRAWING_STATE};
use crate::error::LordspotError;
use crate::state::{DrawingState, EpochIdToLPDrawingState, GlobalState, PerEpochState};
use crate::state::lp_related_state::LPInfo;
use crate::utility::lp_related_utility::process_deposit;

pub fn lp_deposit(
    ctx: Context<LpDeposit>,
    amount: u64
) -> Result<()> {

    require!(amount > 0, LordspotError::AmountCannotBeZero);

    let cpi_context = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            from: ctx.accounts.lp_mint_account.to_account_info(),
            to: ctx.accounts.protocol_usdc_vault.to_account_info(),
            mint: ctx.accounts.usdc_mint.to_account_info(),
            authority: ctx.accounts.signer.to_account_info(),
        },
    );

    transfer_checked(cpi_context, amount, ctx.accounts.usdc_mint.decimals)?;

    process_deposit(
        &ctx.accounts.global_state_account,
        &mut ctx.accounts.drawing_id_to_lp_drawing_state,
        &mut ctx.accounts.lp_info_account,
        &ctx.accounts.deposit_epoch_state,
        &ctx.accounts.prev_per_epoch_state,
        amount
    )?;

    // Save bump only on first creation
    if ctx.accounts.lp_info_account.to_account_info().data_len() == 0 {
        ctx.accounts.lp_info_account.bump = ctx.bumps.lp_info_account;
    }

    Ok(())
}


#[derive(Accounts)]
pub struct LpDeposit<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(address = MOCK_USDC_DEVNET_ADDRESS @ LordspotError::InvalidMintAddress)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(mut, seeds = [SEED_GLOBAL], bump = global_state_account.bump)]
    pub global_state_account: Account<'info, GlobalState>,

    #[account(
        seeds = [SEED_DRAWING_STATE, global_state_account.current_epoch_id.to_le_bytes().as_ref()],
        bump,
        constraint = global_state_account.current_epoch_id == 0 || drawing_state_account.lordspot_lock == false @ LordspotError::LordspotLocked
    )]
    pub drawing_state_account: Account<'info, DrawingState>,

    #[account(
        mut,
        seeds = [SEED_LP_DRAWING_STATE, global_state_account.current_epoch_id.to_le_bytes().as_ref()],
        bump = drawing_id_to_lp_drawing_state.bump
    )]
    pub drawing_id_to_lp_drawing_state: Account<'info, EpochIdToLPDrawingState>,

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
    pub protocol_usdc_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = signer,
        space = 8 + LPInfo::INIT_SPACE,
        seeds = [SEED_LP_INFO, signer.key().as_ref()],
        bump
    )]
    pub lp_info_account: Account<'info, LPInfo>,

    // Current epoch state (used for new deposit)
    #[account(
        seeds = [SEED_PER_EPOCH, global_state_account.current_epoch_id.to_le_bytes().as_ref()],
        bump = current_epoch_state.bump,
    )]
    pub current_epoch_state: Account<'info, PerEpochState>,

    // Historical epoch state for consolidation (only needed if lastDeposit exists)
    #[account(
        seeds = [SEED_PER_EPOCH, lp_info_account.last_deposit_info.epoch_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub deposit_epoch_state: Account<'info, PerEpochState>,

    // Previous epoch state (for pending withdrawals calculation)
    // #[account(
    //     seeds = [SEED_PER_EPOCH, prev_epoch_id.to_le_bytes().as_ref()],
    //     bump,
    //     constraint = global_state_account.current_epoch_id == 0
    //         || prev_epoch_id == global_state_account.current_epoch_id - 1
    //         @ LordspotError::InvalidPreviousEpochId
    // )]
    // pub prev_per_epoch_state: Option<Account<'info, PerEpochState>>,

    #[account(
        seeds = [SEED_PER_EPOCH, global_state_account.current_epoch_id.saturating_sub(1).to_le_bytes().as_ref()],
        bump
    )]
    pub prev_per_epoch_state: Option<Account<'info, PerEpochState>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}


