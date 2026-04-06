use anchor_lang::prelude::*;
use crate::constants::{ADMIN_PUBKEY, SEED_PER_EPOCH, SEED_GLOBAL, PRECISE_UNIT, SEED_LP_DRAWING_STATE, SEED_PROTOCOL_USDC_ACCOUNT, USDC_DEVNET_ADDRESS, SEED_DRAWING_STATE, SEED_TRACKER_PER_EPOCH, TOTAL_TIER_COUNT, SEED_BUCKET};
use crate::state::{PerEpochState, GlobalState, EpochIdToLPDrawingState, DrawingState};
use crate::error::LordspotError;
use crate::utility::main::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};


// ! i guess we need to store all the bumps -- i missed it I guess
pub fn handler(ctx: Context<Initialize>, rngkp : Pubkey, normal_marble_max : u8, pool_total_cap : u64, ticket_price : u64, lp_target_percent : u64, special_ball_min : u8) -> Result<()> {
    let global_state = &mut ctx.accounts.global_state_account;
    let epoch_state = &mut ctx.accounts.per_epoch_state_account;
    let lp_drawing_state  = &mut ctx.accounts.drawing_id_to_lp_drawing_state;

    global_state.switchboard_random_account = rngkp;
    global_state.rand_value = None;
    global_state.bump = ctx.bumps.global_state_account;
    
    global_state.protocol_usdc_vault_bump = ctx.bumps.protocol_usdc_vault;

    global_state.normal_marble_max = normal_marble_max; // 30
    global_state.current_epoch_id = 0;
    global_state.pool_total_cap = pool_total_cap; //
    global_state.ticket_price = ticket_price; // 1e6 -- USDC
    global_state.lp_target_percent = lp_target_percent; //
    global_state.special_ball_min = special_ball_min; // 5
    global_state.edge_per_ticket = (lp_target_percent as u128).checked_mul(ticket_price as u128).ok_or(LordspotError::AirthMaticOverflow)?.checked_div(PRECISE_UNIT as u128).ok_or(LordspotError::AirthMaticUnderflow)? as u64;

    epoch_state.epoch_id = 0;
    epoch_state.shares_percentage = PRECISE_UNIT;



    let calc_lp_pool_cap = calculate_lp_pool_cap(normal_marble_max, ticket_price, lp_target_percent, reserve_percent, pool_total_cap);

    lp_drawing_state.bump = ctx.bumps.drawing_id_to_lp_drawing_state;


    set_lp_pool_cap(&mut global_state.lp_pool_cap, lp_drawing_state.pending_deposits, lp_drawing_state.lp_pool_total, calc_lp_pool_cap.ok_or(LordspotError::AirthMaticOverflow)?)?;


    msg!("✅ [INITIALIZE] PDA created at: {:?}", global_state.key());
    msg!("✅ [INITIALIZE] Linked to Switchboard account: {:?}", global_state.switchboard_random_account);
    Ok(())
}

pub fn close_handler(_ctx: Context<CloseState>) -> Result<()> {
    msg!("💀 [CLOSE] State deleted. SOL returned to Admin.");
    Ok(())
}

pub fn init_lordspot_handler(ctx : Context<InitializeLordsPot>, ini_drawing_time : u64) -> Result<()> {

    ctx.accounts.global_state_account.allow_ticket_purchase = true;

    let (new_lp_value, _) = process_drawing_settlement(
        &ctx.accounts.global_state_account,
        &ctx.accounts.drawing_id_to_lp_drawing_state,
        &ctx.accounts.drawing_state_account,
        &mut ctx.accounts.per_epoch_state_account,
        &ctx.accounts.prev_per_epoch_state_account,
        0,
        0
    )?;

    _set_new_drawing_state(&mut ctx.accounts.global_state_account, &mut ctx.accounts.next_drawing_id_to_lp_drawing_state, &mut ctx.accounts.next_drawing_state_account,new_lp_value, ini_drawing_time)?;


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

