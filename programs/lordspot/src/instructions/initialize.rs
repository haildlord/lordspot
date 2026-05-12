use anchor_lang::prelude::*;
use crate::constants::{ADMIN_PUBKEY, SEED_PER_EPOCH, SEED_GLOBAL, PRECISE_UNIT, SEED_LP_DRAWING_STATE, MOCK_USDC_DEVNET_ADDRESS, SEED_DRAWING_STATE, SEED_TICKET_TRACKER};
use crate::state::{PerEpochState, GlobalState, EpochIdToLPDrawingState, DrawingState, TicketTracker};
use crate::error::LordspotError;
use crate::utility::main::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::event::{GlobalConfigInitialized};

pub fn init_handler(
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
    drawing_duration: u64,
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
        drawing_duration
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

    let drawing_state = &mut ctx.accounts.drawing_state_account;
    drawing_state.bump = ctx.bumps.drawing_state_account;
    drawing_state.lordspot_lock = false;

    emit!(GlobalConfigInitialized{
        pool_total_cap,
        ticket_price,
        normal_marble_max,
        drawing_duration,
        current_epoch_id: global.current_epoch_id,
        lp_target_percent,
        rngkp,
    });

    Ok(())
}

// here whatever init_drawing_time is gonna be, commit_to_random_num_handler can only be called >= init_drawing_time + global.drawing_duration (where global.drawing_duration is gonna be 1 day)
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

    let first_epoch_deadline = init_drawing_time
        .checked_add(global.drawing_duration)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    _set_new_drawing_state(
        global,
        &mut ctx.accounts.next_drawing_id_to_lp_drawing_state,
        &mut ctx.accounts.next_drawing_state_account,
        new_lp_value,
        first_epoch_deadline,
    )?;

    // Initialize the TicketTracker
    let tracker = &mut ctx.accounts.ticket_tracker;
    tracker.bump = ctx.bumps.ticket_tracker;

    Ok(())
}

pub fn change_drawing_time_handler(ctx: Context<ChangeDrawingTime>, new_drawing_time: u64) -> Result<()> {

    let global = &mut ctx.accounts.global_state_account;
    global.drawing_duration = new_drawing_time;

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
        init_if_needed, // ! change to init once deploying
        payer = signer,
        space = 8 + GlobalState::INIT_SPACE,
        seeds = [SEED_GLOBAL],
        bump
    )]
    pub global_state_account: Account<'info, GlobalState>,

    #[account(
        init_if_needed, // ! change to init once deploying
        payer = signer,
        space = 8 + PerEpochState::INIT_SPACE,
        seeds = [SEED_PER_EPOCH, 0u64.to_le_bytes().as_ref()],
        bump
    )]
    pub per_epoch_state_account : Account<'info, PerEpochState>,

    #[account(
        init_if_needed, // ! change to init once deploying
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
        init_if_needed, // ! change to init once deploying
        payer = signer,
        space = 8 + DrawingState::INIT_SPACE,
        seeds = [SEED_DRAWING_STATE, 0u64.to_le_bytes().as_ref()],
        bump
    )]
    pub drawing_state_account: Account<'info, DrawingState>,

    #[account(
        init_if_needed, // ! change to init once deploying
        payer = signer,
        associated_token::mint = usdc_mint,
        associated_token::authority = global_state_account,
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
        mut,
        seeds = [SEED_GLOBAL],
        bump = global_state_account.bump,
        // ! uncomment this when deploying, constraint = global_state_account.current_epoch_id == 0 @ LordspotError::LordspotAlreadyInitialized
    )]
    pub global_state_account: Account<'info, GlobalState>,

    #[account(
        seeds = [SEED_PER_EPOCH, 0u64.to_le_bytes().as_ref()],
        bump = per_epoch_state_account.bump,
        constraint = per_epoch_state_account.shares_percentage == PRECISE_UNIT @ LordspotError::LPDepositsNotInitialized
    )]
    pub per_epoch_state_account : Account<'info, PerEpochState>, // exists and used when current epoch > 0

    #[account(
        seeds = [SEED_PER_EPOCH, global_state_account.current_epoch_id.saturating_sub(1).to_le_bytes().as_ref()],
        bump,
    )]
    pub prev_per_epoch_state_account: Option<Account<'info, PerEpochState>>,

    #[account(
        seeds = [SEED_LP_DRAWING_STATE, 0u64.to_le_bytes().as_ref()],
        bump = drawing_id_to_lp_drawing_state.bump,
        constraint = drawing_id_to_lp_drawing_state.pending_deposits != 0 @ LordspotError::NoLPDeposits
    )]
    pub drawing_id_to_lp_drawing_state : Account<'info, EpochIdToLPDrawingState>,

    #[account(
        init_if_needed, // ! change to init once deploying
        payer = signer,
        space = 8 + EpochIdToLPDrawingState::INIT_SPACE,
        seeds = [SEED_LP_DRAWING_STATE, 1u64.to_le_bytes().as_ref()],
        bump
    )]
    pub next_drawing_id_to_lp_drawing_state : Account<'info, EpochIdToLPDrawingState>,

    #[account(
        init_if_needed, // ! change to init once deploying
        payer = signer,
        space = 8 + DrawingState::INIT_SPACE,
        seeds = [SEED_DRAWING_STATE, 1u64.to_le_bytes().as_ref()],
        bump
    )]
    pub next_drawing_state_account : Account<'info, DrawingState>,

    #[account(
        init_if_needed, // ! change to init once deploying
        payer = signer,
        space = 8 + TicketTracker::INIT_SPACE,
        seeds = [SEED_TICKET_TRACKER, 1u64.to_le_bytes().as_ref()],
        bump
    )]
    pub ticket_tracker: Account<'info, TicketTracker>,

    pub system_program : Program<'info, System>,
}

// ! this is only for testing purposes -- so need ot remove once deploying
#[derive(Accounts)]
pub struct ChangeDrawingTime<'info> {
    #[account(
        mut,
        address = ADMIN_PUBKEY @ LordspotError::InvalidOwner
    )]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_GLOBAL],
        bump = global_state_account.bump,
    )]
    pub global_state_account: Account<'info, GlobalState>,
}