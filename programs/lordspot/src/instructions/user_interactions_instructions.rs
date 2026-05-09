use anchor_lang::prelude::*;

use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface, TransferChecked, transfer_checked};
use crate::state::{GlobalState, DrawingState, TicketTracker, UserTickets, TierPayouts};
use crate::constants::{ SEED_GLOBAL, SEED_DRAWING_STATE, MOCK_USDC_DEVNET_ADDRESS, SEED_USER_TICKETS, SEED_TICKET_TRACKER, SEED_TIER_PAYOUTS};
use crate::error::LordspotError;
use crate::event::*;
use crate::utility::*;


pub fn buy_ticket_handler(
    ctx: Context<BuyTicket>,
    tickets: Vec<TicketInput>,
) -> Result<()> {

    require!(tickets.len() > 0,   LordspotError::NoTicketsProvided);

    let user_tickets = &mut ctx.accounts.user_tickets;

    require!(
        user_tickets.tickets.len() + tickets.len() <= 50,
        LordspotError::UserEpochLimitReached
    );

    // 1. First-time initialization for this user in this epoch
    if user_tickets.owner == Pubkey::default() {
        user_tickets.owner = ctx.accounts.signer.key();
        user_tickets.tickets = Vec::new();
        user_tickets.claimed = Vec::new();
        user_tickets.bump = ctx.bumps.user_tickets;
    }

    // Check if this purchase pushes the global tracker over its limit (1200 total)
    let tracker = &ctx.accounts.ticket_tracker;
    // We check the SUM of both buckets. It cannot exceed 600 total tickets.
    require!(
        tracker.unique_tickets.len() + tracker.duplicate_tickets.len() + tickets.len() <= 600,
        LordspotError::GlobalEpochLimitReached
    );

    // 2. Calculate Total Cost
    let ticket_count = tickets.len() as u64;
    let total_cost = (ticket_count)
        .checked_mul(ctx.accounts.global_state_account.ticket_price)
        .ok_or(LordspotError::AirthMaticOverflow)?;

    // 3. Charge the User full amount via CPI
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.buyers_usdc_account.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.protocol_usdc_vault.to_account_info(),
                authority: ctx.accounts.signer.to_account_info(),
            },
        ),
        total_cost,
        ctx.accounts.usdc_mint.decimals,
    )?;

    // 4. Validate, check duplicates, and update prize pool safely
    let packed_array = _validate_and_store_tickets(
        &ctx.accounts.global_state_account,
        &mut ctx.accounts.ticket_tracker,
        &mut ctx.accounts.user_tickets,
        &mut ctx.accounts.drawing_state_account,
        &tickets
    )?;

    // 5. Only update lp_earnings and total_tickets here
    let drawing = &mut ctx.accounts.drawing_state_account;

    drawing.total_tickets = drawing.total_tickets
        .checked_add(ticket_count)
        .ok_or(LordspotError::AirthMaticOverflow)?;

    drawing.lp_earnings = drawing.lp_earnings
        .checked_add(total_cost)
        .ok_or(LordspotError::AirthMaticOverflow)?;

    emit!(TicketsBoughtEvent {
        buyer: ctx.accounts.signer.key(),
        epoch_id: ctx.accounts.global_state_account.current_epoch_id,
        packed_tickets: packed_array,
        tickets_count : drawing.total_tickets,
        total_cost,
    });

    Ok(())
}


#[derive(Accounts)]
pub struct BuyTicket<'info> {

    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        seeds = [SEED_GLOBAL],
        bump = global_state_account.bump,
        constraint = global_state_account.allow_ticket_purchase == true
        @ LordspotError::TicketPurchaseNotAllowed,
    )]
    pub global_state_account: Account<'info, GlobalState>,

    #[account(
        mut,
        seeds = [SEED_DRAWING_STATE, global_state_account.current_epoch_id.to_le_bytes().as_ref()],
        bump = drawing_state_account.bump,
        constraint = drawing_state_account.lordspot_lock == false @ LordspotError::LordspotIsLocked,
        constraint = drawing_state_account.prize_pool != 0 @ LordspotError::NotEnoughLiquidity,
    )]
    pub drawing_state_account: Account<'info, DrawingState>,

    // Global tracker for isDup detection
    #[account(
        mut,
        seeds = [SEED_TICKET_TRACKER, global_state_account.current_epoch_id.to_le_bytes().as_ref()],
        bump = ticket_tracker.bump,
    )]
    pub ticket_tracker: Account<'info, TicketTracker>,

    // User's tickets in this epoch (only 1 PDA per user per epoch)
    #[account(
        init_if_needed,
        payer = signer,
        space = 8 + UserTickets::INIT_SPACE,
        seeds = [SEED_USER_TICKETS, signer.key().as_ref(), global_state_account.current_epoch_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub user_tickets: Account<'info, UserTickets>,

    #[account(address = MOCK_USDC_DEVNET_ADDRESS @ LordspotError::InvalidMintAddress)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::authority = signer,
        token::mint = usdc_mint,
    )]
    pub buyers_usdc_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = global_state_account
    )]
    pub protocol_usdc_vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}


#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TicketInput {
    pub normal_marbles: Vec<u8>,  // exactly 5 values, each 1..=marble_max
    pub special_marble: u8,       // 1..=special_marble_max
}


pub fn claim_rewards_handler<'info>(
    ctx: Context<ClaimRewards>,
    _epoch_id: u64,
    packed_ticket_to_claim: u64
) -> Result<()> {
    let user_info = &mut ctx.accounts.user_tickets;
    let winning_ticket = ctx.accounts.drawing_state_account.winning_ticket;
    let normal_max = ctx.accounts.global_state_account.normal_marble_max;

    // 1. FIND UNCLAIMED INSTANCE (Ownership/Validity Check)
    let ticket_index = user_info.tickets
        .iter()
        .enumerate()
        .position(|(i, &t)| t == packed_ticket_to_claim && !user_info.claimed[i])
        .ok_or(LordspotError::TicketAlreadyClaimedOrNotFound)?;

    // 2. MARK AS CLAIMED / "BURN" (Do this regardless of win/loss)
    // This mirrors `jackpotNFT.burnTicket(ticketId)`
    user_info.claimed[ticket_index] = true;

    // 3. CALCULATE TIER
    let tier_id = calculate_ticket_tier(packed_ticket_to_claim, winning_ticket, normal_max);

    // 4. PAYOUT LOGIC
    // We check tier_id and payout_amount. If it's a loss (Tier 0 or Payout 0),
    // we simply skip the transfer, but the ticket stays "claimed".
    let payout_amount = ctx.accounts.tier_payouts.tier_payouts[tier_id as usize];

    if payout_amount > 0 {
        let seeds = &[SEED_GLOBAL, &[ctx.accounts.global_state_account.bump]];
        let signer_seeds = &[&seeds[..]];

        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.protocol_usdc_vault.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.user_usdc_account.to_account_info(),
                    authority: ctx.accounts.global_state_account.to_account_info(),
                },
                signer_seeds,
            ),
            payout_amount,
            ctx.accounts.usdc_mint.decimals,
        )?;
    }

    emit!(TicketClaimedEvent {
        epoch_id: _epoch_id,
        buyer: ctx.accounts.signer.key(),
        packed_ticket: packed_ticket_to_claim,
        reward_amount: payout_amount,
    });

    Ok(())
}




#[derive(Accounts)]
#[instruction(epoch_id: u64)]
pub struct ClaimRewards<'info> {

    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        seeds = [SEED_GLOBAL],
        bump = global_state_account.bump,
    )]
    pub global_state_account: Account<'info, GlobalState>,

    // Drawing state for the epoch being claimed
    // Read only — just for reference if needed later
    #[account(
        seeds = [
            SEED_DRAWING_STATE,
            epoch_id.to_le_bytes().as_ref(),
        ],
        bump = drawing_state_account.bump,
        constraint = epoch_id > 0 && global_state_account.current_epoch_id > epoch_id @ LordspotError::IncorrectEpochIdToClaim,
    )]
    pub drawing_state_account: Account<'info, DrawingState>,

    #[account(
        mut,
        seeds = [SEED_TICKET_TRACKER, epoch_id.to_le_bytes().as_ref()],
        bump = ticket_tracker.bump,
    )]
    pub ticket_tracker: Account<'info, TicketTracker>,

    #[account(
        mut,
        seeds = [SEED_USER_TICKETS, signer.key().as_ref(), epoch_id.to_le_bytes().as_ref()],
        bump = user_tickets.bump,
    )]
    pub user_tickets: Account<'info, UserTickets>,


    #[account(
        address = MOCK_USDC_DEVNET_ADDRESS @ LordspotError::InvalidMintAddress
    )]
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    // User's USDC account — receives payout
    #[account(
        mut,
        token::authority = signer,
        token::mint = usdc_mint,
    )]
    pub user_usdc_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = global_state_account
    )]
    pub protocol_usdc_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [SEED_TIER_PAYOUTS, epoch_id.to_le_bytes().as_ref()],
        bump = ticket_tracker.bump,
    )]
    pub tier_payouts : Account<'info, TierPayouts>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}