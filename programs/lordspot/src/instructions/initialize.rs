use anchor_lang::prelude::*;
use crate::constants::{ADMIN_PUBKEY, SEED_PER_EPOCH, SEED_GLOBAL, PRECISE_UNIT, SEED_LP_DRAWING_STATE, SEED_PROTOCOL_USDC_ACCOUNT, USDC_DEVNET_ADDRESS, SEED_DRAWING_STATE, BONUSBALL_SOFT_CAP, BONUSBALL_HARD_CAP, GOVERNANCE_POOL_CAP, PROTOCOL_FEE, PROTOCOL_FEE_THRESHOLD};
use crate::state::{PerEpochState, GlobalState, EpochIdToLPDrawingState, DrawingState};
use crate::error::LordspotError;
use crate::utility::main::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};


// ! i guess we need to store all the bumps -- i missed it I guess
pub fn handler(
    ctx: Context<Initialize>,
    rngkp: Pubkey,
    normal_marble_max: u8,
    // We no longer need pool_total_cap as param — we hardcode the governance cap
    ticket_price: u64,
    lp_target_percent: u64,
    special_ball_min: u8,
) -> Result<()> {
    let global = &mut ctx.accounts.global_state_account;

    global.switchboard_random_account = rngkp;
    global.bump = ctx.bumps.global_state_account;
    global.protocol_usdc_vault_bump = ctx.bumps.protocol_usdc_vault;

    global.normal_marble_max = normal_marble_max; // 30
    global.current_epoch_id = 0;
    global.ticket_price = ticket_price; // 1e6
    global.lp_target_percent = lp_target_percent; // 30%
    global.special_ball_min = special_ball_min; // 5
    global.special_ball_soft_cap = BONUSBALL_SOFT_CAP;
    global.special_ball_hard_cap = BONUSBALL_HARD_CAP;

    // Governance cap (1.1M USDC)
    global.pool_total_cap = GOVERNANCE_POOL_CAP;

    global.edge_per_ticket = (lp_target_percent as u128)
        .checked_mul(ticket_price as u128)
        .ok_or(LordspotError::AirthMaticOverflow)?
        .checked_div(PRECISE_UNIT as u128)
        .ok_or(LordspotError::AirthMaticUnderflow)? as u64;

    global.protocol_fee = PROTOCOL_FEE;
    global.protocol_fee_threshold = PROTOCOL_FEE_THRESHOLD;

    // Per-epoch state
    let epoch_state = &mut ctx.accounts.per_epoch_state_account;
    epoch_state.epoch_id = 0;
    epoch_state.shares_percentage = PRECISE_UNIT;
    epoch_state.bump = ctx.bumps.per_epoch_state_account;

    // LP state for epoch 0
    let lp_state = &mut ctx.accounts.drawing_id_to_lp_drawing_state;
    lp_state.bump = ctx.bumps.drawing_id_to_lp_drawing_state;

    // Calculate and set initial LP pool cap (exactly like Solidity)
    let soft_cap = calculate_lp_pool_soft_cap(
        normal_marble_max,
        ticket_price,
        lp_target_percent,
    )?;
    let final_cap = soft_cap.min(GOVERNANCE_POOL_CAP);

    set_lp_pool_cap(
        &mut global.lp_pool_cap,
        lp_state.pending_deposits,
        lp_state.lp_pool_total,
        final_cap,
    )?;

    Ok(())
}


pub fn close_handler(_ctx: Context<CloseState>) -> Result<()> {
    msg!("💀 [CLOSE] State deleted. SOL returned to Admin.");
    Ok(())
}

pub fn init_lordspot_handler(ctx: Context<InitializeLordsPot>, ini_drawing_time: u64) -> Result<()> {
    let global = &mut ctx.accounts.global_state_account;
    global.allow_ticket_purchase = true;

    let (new_lp_value, _) = process_drawing_settlement(
        global,
        &ctx.accounts.drawing_id_to_lp_drawing_state,
        &ctx.accounts.drawing_state_account,
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
        ini_drawing_time,
    )?;

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
        address = USDC_DEVNET_ADDRESS @ LordspotError::InvalidMintAddress
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
    pub per_epoch_state_account : Account<'info, PerEpochState>,

    pub prev_per_epoch_state_account: Option<Account<'info, PerEpochState>>,

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
        seeds = [SEED_DRAWING_STATE],
        bump
    )]
    pub drawing_state_account : Account<'info, DrawingState>,

    #[account(
        init,
        payer = signer,
        space = 8 + DrawingState::INIT_SPACE,
        seeds = [SEED_DRAWING_STATE, 1u64.to_le_bytes().as_ref()],
        bump
    )]
    pub next_drawing_state_account : Account<'info, DrawingState>,

    pub system_program : Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseState<'info> {
    #[account(
        mut,
        close = signer,
        seeds = [SEED_GLOBAL],
        bump = global_state_account.bump,
        address = ADMIN_PUBKEY @ LordspotError::InvalidOwner
    )]
    pub global_state_account: Account<'info, GlobalState>,

    #[account(mut)]
    pub signer: Signer<'info>,
}

