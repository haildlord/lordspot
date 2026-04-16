use anchor_lang::prelude::*;
use crate::constants::{ADMIN_PUBKEY, SEED_PER_EPOCH, SEED_GLOBAL, PRECISE_UNIT, SEED_LP_DRAWING_STATE, SEED_PROTOCOL_USDC_ACCOUNT, MOCK_USDC_DEVNET_ADDRESS, SEED_DRAWING_STATE, SEED_TICKET_TRACKER};
use crate::state::{PerEpochState, GlobalState, EpochIdToLPDrawingState, DrawingState, TicketTracker};
use crate::error::LordspotError;
use crate::utility::main::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
// ! in this page we have used ADMIN_PUBKEY when deploying use : DEVNET_ADMIN_PUBKEY

pub fn handler_init(
    ctx: Context<Initialize>,
    rngkp: Pubkey,
    normal_marble_max: u8,
    pool_total_cap: u64,
    ticket_price: u64,
    lp_target_percent: u64,
    special_ball_min: u8,
    special_ball_soft_cap: u8,
    special_ball_hard_cap: u8,
    protocol_fee: u64,
    protocol_fee_threshold: u64,
) -> Result<()> {
    let global = &mut ctx.accounts.global_state_account;

    initialize_global_config(
        global,
        rngkp,
        normal_marble_max,
        pool_total_cap,
        ticket_price,
        lp_target_percent,
        special_ball_min,
        special_ball_soft_cap,
        special_ball_hard_cap,
        protocol_fee,
        protocol_fee_threshold,
        ctx.bumps.global_state_account,
        ctx.bumps.protocol_usdc_vault,
    )?;

    // ── Initialize Per-Epoch State ───────────────────────────────
    let epoch_state = &mut ctx.accounts.per_epoch_state_account;
    initialize_epoch_state(epoch_state, ctx.bumps.per_epoch_state_account)?;

    // ── Initialize LP State (bump only) ──────────────────────────
    let lp_state = &mut ctx.accounts.drawing_id_to_lp_drawing_state;
    lp_state.bump = ctx.bumps.drawing_id_to_lp_drawing_state;

    // ── Calculate & Set Initial LP Pool Cap ─
    initialize_lp_pool_cap(
        global,
        lp_state,
        normal_marble_max,
        ticket_price,
        lp_target_percent,
        special_ball_soft_cap,
        pool_total_cap,
    )?;

    Ok(())
}

pub fn init_lordspot_handler(ctx: Context<InitializeLordsPot>, init_drawing_time: u64) -> Result<()> {

    let global = &mut ctx.accounts.global_state_account;
    global.allow_ticket_purchase = true;

    // save the bumps for both the init accounts
    ctx.accounts.next_drawing_id_to_lp_drawing_state.bump = ctx.bumps.next_drawing_id_to_lp_drawing_state;
    ctx.accounts.next_drawing_state_account.bump = ctx.bumps.next_drawing_state_account;

    let (new_lp_value, _) = process_drawing_settlement(
        global,
        &ctx.accounts.drawing_id_to_lp_drawing_state,
        0,    // is 0 only because current_epoch_id == 0
        &mut ctx.accounts.per_epoch_state_account,
        &ctx.accounts.prev_per_epoch_state_account,
        0,   // user_winnings
        0,   // protocol_fee
    )?;

    _set_new_drawing_state(
        global,
        &mut ctx.accounts.next_drawing_id_to_lp_drawing_state,
        &mut ctx.accounts.next_drawing_state_account,
        new_lp_value,
        init_drawing_time,
    )?;

    // Initialize the TicketTracker
    let tracker = &mut ctx.accounts.ticket_tracker;
    tracker.drawing_id = 1;                    // first real epoch
    tracker.bump = ctx.bumps.ticket_tracker;

    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        mut,
        address = ADMIN_PUBKEY @ LordspotError::InvalidOwner
    )]
    pub signer : Signer<'info>,

    #[account(
        init,
        payer = signer,
        space = 8 + GlobalState::INIT_SPACE,
        seeds = [SEED_GLOBAL],
        bump
    )]
    pub global_state_account: Account<'info, GlobalState>,

    #[account(
        init,
        payer = signer,
        space = 8 + PerEpochState::INIT_SPACE,
        seeds = [SEED_PER_EPOCH, 0u64.to_le_bytes().as_ref()],
        bump
    )]
    pub per_epoch_state_account : Account<'info, PerEpochState>,

    #[account(
        init,
        payer = signer,
        space = 8 + EpochIdToLPDrawingState::INIT_SPACE,
        seeds = [SEED_LP_DRAWING_STATE, 0u64.to_le_bytes().as_ref()],
        bump
    )]
    pub drawing_id_to_lp_drawing_state : Account<'info, EpochIdToLPDrawingState>,

    #[account(
        address = MOCK_USDC_DEVNET_ADDRESS @ LordspotError::InvalidMintAddress
    )]
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = signer,
        token::mint = usdc_mint,
        token::authority = global_state_account,
        seeds=[SEED_PROTOCOL_USDC_ACCOUNT],
        bump
    )]
    pub protocol_usdc_vault : InterfaceAccount<'info, TokenAccount>,

    pub system_program : Program<'info, System>,
    pub associated_token_program : Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct InitializeLordsPot<'info> {

    #[account(
        mut,
        address = ADMIN_PUBKEY @ LordspotError::InvalidOwner
    )]
    pub signer : Signer<'info>,

    #[account(
        seeds = [SEED_GLOBAL],
        bump = global_state_account.bump,
        constraint = global_state_account.current_epoch_id == 0 @ LordspotError::LordspotAlreadyInitialized
    )]
    pub global_state_account: Account<'info, GlobalState>,

    #[account(
        seeds = [SEED_PER_EPOCH, 0u64.to_le_bytes().as_ref()],
        bump = per_epoch_state_account.bump,
        constraint = per_epoch_state_account.shares_percentage == PRECISE_UNIT @ LordspotError::LPDepositsNotInitialized
    )]
    pub per_epoch_state_account : Account<'info, PerEpochState>, // exists and used when current epoch > 0

    pub prev_per_epoch_state_account: Option<Account<'info, PerEpochState>>, // exists and used when current epoch > 0

    #[account(
        seeds = [SEED_LP_DRAWING_STATE, 0u64.to_le_bytes().as_ref()],
        bump = drawing_id_to_lp_drawing_state.bump,
        constraint = drawing_id_to_lp_drawing_state.pending_deposits != 0 @ LordspotError::NoLPDeposits
    )]
    pub drawing_id_to_lp_drawing_state : Account<'info, EpochIdToLPDrawingState>,

    #[account(
        init,
        payer = signer,
        space = 8 + EpochIdToLPDrawingState::INIT_SPACE,
        seeds = [SEED_LP_DRAWING_STATE, 1u64.to_le_bytes().as_ref()],
        bump
    )]
    pub next_drawing_id_to_lp_drawing_state : Account<'info, EpochIdToLPDrawingState>,

    #[account(
        init,
        payer = signer,
        space = 8 + DrawingState::INIT_SPACE,
        seeds = [SEED_DRAWING_STATE, 1u64.to_le_bytes().as_ref()],
        bump
    )]
    pub next_drawing_state_account : Account<'info, DrawingState>,

    #[account(
        init,
        payer = signer,
        space = 8 + TicketTracker::INIT_SPACE,
        seeds = [SEED_TICKET_TRACKER, 1u64.to_le_bytes().as_ref()],
        bump
    )]
    pub ticket_tracker: Account<'info, TicketTracker>,

    pub system_program : Program<'info, System>,
}

