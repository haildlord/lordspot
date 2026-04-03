use anchor_lang::prelude::*;

use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface, TransferChecked, transfer_checked};
use crate::state::{GlobalState, DrawingState};
use crate::constants::{ SEED_GLOBAL, SEED_DRAWING_STATE, USDC_DEVNET_ADDRESS, SEED_PROTOCOL_USDC_ACCOUNT, NORMAL_SELECTABLE_MARBLE_COUNT, SEED_BUCKET };
use crate::error::LordspotError;
use crate::utility::user_related_utility::*;


pub fn buy_ticket_handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, BuyTicket<'info>>,
    tickets: Vec<TicketInput>,
) -> Result<()> {

    // --- Validate ticket count ---
    require!(tickets.len() > 0,   LordspotError::NoTicketsProvided);
    require!(tickets.len() <= 20, LordspotError::TooManyTickets);
    require!(
        ctx.remaining_accounts.len() == tickets.len(),
        LordspotError::TicketAccountMismatch
    );

    // --- Charge USDC upfront for all tickets ---
    let total_cost = (tickets.len() as u64)
        .checked_mul(ctx.accounts.global_state_account.ticket_price)
        .ok_or(LordspotError::AirthMaticOverflow)?;

    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from:      ctx.accounts.buyers_usdc_account.to_account_info(),
                mint:      ctx.accounts.usdc_mint.to_account_info(),
                to:        ctx.accounts.protocol_usdc_vault.to_account_info(),
                authority: ctx.accounts.signer.to_account_info(),
            },
        ),
        total_cost,
        ctx.accounts.usdc_mint.decimals,
    )?;

    // --- Validate and store each ticket ---
    // We read these BEFORE the mutable borrow of drawing_state_account below
    let count       = tickets.len() as u64;
    let edge         = ctx.accounts.global_state_account.edge_per_ticket;
    let ticket_price = ctx.accounts.global_state_account.ticket_price;
    let epoch_id       = ctx.accounts.global_state_account.current_epoch_id;
    let starting_index = ctx.accounts.drawing_state_account.total_tickets;

    _validate_and_store_tickets(
        &ctx.accounts.global_state_account,
        &ctx.accounts.signer,
        &ctx.accounts.drawing_state_account,
        &ctx.accounts.system_program,
        epoch_id,
        starting_index,
        &tickets,
        ctx.remaining_accounts,
        ctx.program_id,
    )?;

    // --- Update drawing state ---
    // Mutable borrow happens AFTER _validate_and_store_tickets is done
    // No lifetime conflict
    let drawing_mut = &mut ctx.accounts.drawing_state_account;

    drawing_mut.total_tickets = drawing_mut
        .total_tickets
        .checked_add(tickets.len() as u64)
        .ok_or(LordspotError::AirthMaticOverflow)?;
    
    let net_per_ticket = ticket_price
        .checked_sub(edge)
        .ok_or(LordspotError::AirthMaticUnderflow)?;

    drawing_mut.prize_pool = drawing_mut.prize_pool
        .checked_add(net_per_ticket.checked_mul(count).ok_or(LordspotError::AirthMaticOverflow)?)
        .ok_or(LordspotError::AirthMaticOverflow)?;

    drawing_mut.lp_earnings = drawing_mut.lp_earnings
        .checked_add(edge.checked_mul(count).ok_or(LordspotError::AirthMaticOverflow)?)
        .ok_or(LordspotError::AirthMaticOverflow)?;


    Ok(())
}



#[derive(Accounts)]
pub struct BuyTicket<'info> {

    #[account(mut)]
    pub signer : Signer<'info>,

    #[account(
        seeds = [SEED_GLOBAL],
        bump = global_state_account.bump,
        constraint = global_state_account.allow_ticket_purchase == true @ LordspotError::TicketPurchaseNotAllowed,
    )]
    pub global_state_account: Account<'info, GlobalState>,

    #[account(
        mut,
        seeds = [SEED_DRAWING_STATE, global_state_account.current_epoch_id.to_le_bytes().as_ref()],
        bump = drawing_state_account.bump,
        constraint = drawing_state_account.lordspot_lock == false @ LordspotError::LordspotIsLocked,
        constraint = drawing_state_account.prize_pool != 0 @ LordspotError::NotEnoughLiquidity,
    )]
    pub drawing_state_account : Account<'info, DrawingState>,


    #[account(
        address = USDC_DEVNET_ADDRESS @ LordspotError::InvalidMintAddress
    )]
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::authority = signer,
        token::mint = usdc_mint,
    )]
    pub buyers_usdc_account : InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [SEED_PROTOCOL_USDC_ACCOUNT],
        bump = global_state_account.protocol_usdc_vault_bump,
        token::mint = usdc_mint,
        token::authority = global_state_account
    )]
    pub protocol_usdc_vault : InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program : Program<'info, System>,
}


#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TicketInput {
    pub normal_marbles: Vec<u8>,  // exactly 5 values, each 1..=marble_max
    pub special_marble: u8,       // 1..=special_marble_max
}
