use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenInterface, TokenAccount, TransferChecked, transfer_checked};
use crate::constants::{MOCK_USDC_DEVNET_ADDRESS, SEED_GLOBAL, SEED_LP_INFO, SEED_LP_DRAWING_STATE, SEED_PER_EPOCH, SEED_DRAWING_STATE};
use crate::error::LordspotError;
use crate::state::{DrawingState, EpochIdToLPDrawingState, GlobalState, PerEpochState, LPInfo};
use crate::utility::lp_related_utility::*;
use crate::event::*;


pub fn lp_deposit_handler(
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
    if ctx.accounts.lp_info_account.bump == 0 {
        ctx.accounts.lp_info_account.bump = ctx.bumps.lp_info_account;
    }

    emit!(LpDepositedEvent {
        user: ctx.accounts.signer.key(),
        epoch_id: ctx.accounts.global_state_account.current_epoch_id,
        amount_usdc: amount,
    });

    Ok(())
}

pub fn initiate_withdraw_handler(
    ctx: Context<InitiateWithdraw>,
    amount_in_shares: u64
) -> Result<()> {
    require!(amount_in_shares > 0, LordspotError::AmountCannotBeZero);

    let lp_info = &mut ctx.accounts.lp_info_account;
    let global_state = &ctx.accounts.global_state_account;
    let epoch_to_lp = &mut ctx.accounts.drawing_id_to_lp_drawing_state;

    // 1. Consolidate previous deposits (Pass the Option)
    _consolidate_deposits(
        lp_info,
        &ctx.accounts.deposit_epoch_state,
        global_state.current_epoch_id
    )?;

    // 2. Check sufficient shares
    require!(
        lp_info.consolidated_shares >= amount_in_shares,
        LordspotError::InsufficientShares
    );

    // 3. Consolidate previous withdrawals (Pass the Option)
    _consolidate_withdrawals(
        lp_info,
        &ctx.accounts.withdrawal_epoch_state, // withdrawal epoch_%
        global_state.current_epoch_id
    )?;

    // 4. Update pending withdrawals
    lp_info.withdrawal_info.amount_in_shares = (lp_info.withdrawal_info.amount_in_shares as u128)
        .checked_add(amount_in_shares as u128)
        .ok_or(LordspotError::AirthMaticOverflow)? as u64;

    lp_info.withdrawal_info.epoch_id = global_state.current_epoch_id;

    // 5. Deduct from consolidated shares and add to global pending pool
    lp_info.consolidated_shares = (lp_info.consolidated_shares as u128)
        .checked_sub(amount_in_shares as u128)
        .ok_or(LordspotError::AirthMaticUnderflow)? as u64;

    epoch_to_lp.pending_withdrawals = (epoch_to_lp.pending_withdrawals as u128)
        .checked_add(amount_in_shares as u128)
        .ok_or(LordspotError::AirthMaticOverflow)? as u64;

    emit!(LpWithdrawInitiatedEvent {
        user: ctx.accounts.signer.key(),
        epoch_id: global_state.current_epoch_id,
        amount_shares: amount_in_shares,
    });

    Ok(())
}

pub fn finalize_withdraw_handler(ctx: Context<FinalizeWithdraw>) -> Result<()> {
    let lp_info = &mut ctx.accounts.lp_info_account;
    let global_state = &ctx.accounts.global_state_account;
    let epoch_to_lp = &mut ctx.accounts.drawing_id_to_lp_drawing_state; // <-- Bring this in

    // 1. Accrue pending withdrawals into claimable withdrawals
    _consolidate_withdrawals(
        lp_info,
        &ctx.accounts.withdrawal_epoch_state,
        global_state.current_epoch_id
    )?;

    let withdrawable_amount = lp_info.claimable_withdrawals;
    require!(withdrawable_amount > 0, LordspotError::NothingToWithdraw);

    // 2. CRITICAL FIX: Deduct from global pool total so math doesn't break
    epoch_to_lp.lp_pool_total = epoch_to_lp.lp_pool_total
        .checked_sub(withdrawable_amount)
        .ok_or(LordspotError::AirthMaticUnderflow)?;

    // 3. Zero out claimable state BEFORE the transfer
    lp_info.claimable_withdrawals = 0;

    // 4. Setup CPI for PDA to transfer USDC
    let seeds = &[
        SEED_GLOBAL,
        &[global_state.bump],
    ];

    let signer_seeds = &[&seeds[..]];

    let cpi_context = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            from: ctx.accounts.protocol_usdc_vault.to_account_info(),
            to: ctx.accounts.user_usdc_account.to_account_info(),
            mint: ctx.accounts.usdc_mint.to_account_info(),
            authority: global_state.to_account_info(),
        },
        signer_seeds
    );

    // 5. Execute the transfer
    transfer_checked(cpi_context, withdrawable_amount, ctx.accounts.usdc_mint.decimals)?;

    emit!(LpWithdrawFinalizedEvent {
        user: ctx.accounts.signer.key(),
        epoch_id: global_state.current_epoch_id,
        amount_usdc_claimed: withdrawable_amount,
    });

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
        bump = drawing_state_account.bump,
        constraint = drawing_state_account.lordspot_lock == false @ LordspotError::LordspotLocked
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

    #[account(
        seeds = [SEED_PER_EPOCH, lp_info_account.last_deposit_info.epoch_id.to_le_bytes().as_ref()],
        bump
    )]
    pub deposit_epoch_state: Option<Account<'info, PerEpochState>>,

    #[account(
        seeds = [SEED_PER_EPOCH, global_state_account.current_epoch_id.saturating_sub(1).to_le_bytes().as_ref()],
        bump
    )]
    pub prev_per_epoch_state: Option<Account<'info, PerEpochState>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitiateWithdraw<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(seeds = [SEED_GLOBAL], bump = global_state_account.bump)]
    pub global_state_account: Account<'info, GlobalState>,

    #[account(
        seeds = [SEED_DRAWING_STATE, global_state_account.current_epoch_id.to_le_bytes().as_ref()],
        bump = drawing_state_account.bump,
        constraint = drawing_state_account.lordspot_lock == false @ LordspotError::LordspotLocked
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
        seeds = [SEED_LP_INFO, signer.key().as_ref()],
        bump = lp_info_account.bump
    )]
    pub lp_info_account: Account<'info, LPInfo>,

    #[account(
        seeds = [SEED_PER_EPOCH, lp_info_account.last_deposit_info.epoch_id.to_le_bytes().as_ref()],
        bump
    )]
    pub deposit_epoch_state: Option<Account<'info, PerEpochState>>,

    #[account(
        seeds = [SEED_PER_EPOCH, lp_info_account.withdrawal_info.epoch_id.to_le_bytes().as_ref()],
        bump
    )]
    pub withdrawal_epoch_state: Option<Account<'info, PerEpochState>>,
}

#[derive(Accounts)]
pub struct FinalizeWithdraw<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(address = MOCK_USDC_DEVNET_ADDRESS @ LordspotError::InvalidMintAddress)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(seeds = [SEED_GLOBAL], bump = global_state_account.bump)]
    pub global_state_account: Account<'info, GlobalState>,

    #[account(
        seeds = [SEED_DRAWING_STATE, global_state_account.current_epoch_id.to_le_bytes().as_ref()],
        bump = drawing_state_account.bump,
        constraint = drawing_state_account.lordspot_lock == false @ LordspotError::LordspotIsLocked // <-- Fixed error name
    )]
    pub drawing_state_account: Account<'info, DrawingState>,

    // ADDED THIS ACCOUNT: We need it to deduct the pool total!
    #[account(
        mut,
        seeds = [SEED_LP_DRAWING_STATE, global_state_account.current_epoch_id.to_le_bytes().as_ref()],
        bump
    )]
    pub drawing_id_to_lp_drawing_state: Account<'info, EpochIdToLPDrawingState>,

    #[account(
        mut,
        seeds = [SEED_LP_INFO, signer.key().as_ref()],
        bump = lp_info_account.bump
    )]
    pub lp_info_account: Account<'info, LPInfo>,

    #[account(
        seeds = [SEED_PER_EPOCH, lp_info_account.withdrawal_info.epoch_id.to_le_bytes().as_ref()],
        bump
    )]
    pub withdrawal_epoch_state: Option<Account<'info, PerEpochState>>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = signer,
        associated_token::token_program = token_program
    )]
    pub user_usdc_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = global_state_account,
    )]
    pub protocol_usdc_vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}



