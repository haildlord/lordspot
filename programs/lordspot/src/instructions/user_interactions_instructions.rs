use anchor_lang::prelude::*;

use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface, TransferChecked, transfer_checked};
use crate::state::{GlobalState, DrawingState, TallyStatus, TallyState, TicketAccount};
use crate::constants::{ SEED_GLOBAL, SEED_DRAWING_STATE, USDC_DEVNET_ADDRESS, SEED_PROTOCOL_USDC_ACCOUNT, SEED_TALLY, SEED_TICKET};
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

pub fn claim_rewards_handler<'info>(
    ctx:      Context<'_, '_, 'info, 'info, ClaimRewards<'info>>,
    epoch_id: u64,  // which epoch this ticket belongs to
) -> Result<()> {

    // ----------------------------------------------------------
    // 1. VERIFY DRAWING IS COMPLETED
    //    ticket epoch must be strictly less than current epoch
    //    if equal — drawing still in progress
    // ----------------------------------------------------------
    require!(
        epoch_id < ctx.accounts.global_state_account.current_epoch_id,
        LordspotError::DrawingNotCompleted
    );

    // ----------------------------------------------------------
    // 2. VERIFY CRANK IS SETTLED
    // ----------------------------------------------------------
    require!(
        ctx.accounts.tally_state.status == TallyStatus::Settled,
        LordspotError::TallyNotSettled
    );

    // ----------------------------------------------------------
    // 3. VERIFY TICKET OWNERSHIP AND NOT ALREADY CLAIMED
    // ----------------------------------------------------------
    let ticket = &ctx.accounts.ticket_account;

    require!(
        ticket.owner == ctx.accounts.signer.key(),
        LordspotError::InvalidOwner
    );
    require!(
        ticket.draw_id == epoch_id,
        LordspotError::InvalidEpochId
    );
    require!(
        !ticket.claimed,
        LordspotError::AlreadyClaimed
    );

    // ----------------------------------------------------------
    // 4. COMPUTE TIER — same logic as crank
    //    popcount(ticket.bitvec AND winning_normals_bitvec) = normal matches
    //    check winning_special_bit_pos in ticket.bitvec = bonus hit
    // ----------------------------------------------------------
    let winning_normals  = ctx.accounts.tally_state.winning_normals_bitvec;
    let winning_special  = ctx.accounts.tally_state.winning_special_bit_pos as usize;

    let mut normal_matches: u8 = 0;
    for j in 0..32usize {
        normal_matches += (ticket.bitvec[j] & winning_normals[j]).count_ones() as u8;
    }

    let special_byte = winning_special / 8;
    let special_bit  = winning_special % 8;
    let bonus_hit    = (ticket.bitvec[special_byte] >> special_bit) & 1 == 1;

    let tier = (normal_matches as usize * 2) + if bonus_hit { 1 } else { 0 };

    // ----------------------------------------------------------
    // 5. GET PAYOUT FOR THIS TIER
    //    tier_payouts[tier] = 0 means this tier has no prize
    // ----------------------------------------------------------
    let payout = ctx.accounts.tally_state.tier_payouts[tier];

    // ----------------------------------------------------------
    // 6. TRANSFER USDC FROM VAULT TO USER
    //    Even if payout = 0 we still close the account below
    //    so user gets rent back regardless
    // ----------------------------------------------------------
    if payout > 0 {
        let signer_seeds: &[&[&[u8]]] = &[&[
            SEED_GLOBAL,
            &[ctx.accounts.global_state_account.bump],
        ]];

        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from:      ctx.accounts.protocol_usdc_vault.to_account_info(),
                    mint:      ctx.accounts.usdc_mint.to_account_info(),
                    to:        ctx.accounts.user_usdc_account.to_account_info(),
                    authority: ctx.accounts.global_state_account.to_account_info(),
                },
                signer_seeds,
            ),
            payout,
            ctx.accounts.usdc_mint.decimals,
        )?;
    }

    // ----------------------------------------------------------
    // 7. CLOSE TICKET ACCOUNT — rent returned to signer
    //    This replaces NFT burning from EVM
    //    Once closed — account gone — no double claim possible
    //    The `close = signer` constraint in accounts struct handles this
    // ----------------------------------------------------------

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

// ============================================================
// ACCOUNTS STRUCT
// ============================================================

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
    )]
    pub drawing_state_account: Account<'info, DrawingState>,

    // TallyState for this epoch — must be Settled
    #[account(
        seeds = [
            SEED_TALLY,
            epoch_id.to_le_bytes().as_ref(),
        ],
        bump = tally_state.bump,
        constraint = tally_state.status == TallyStatus::Settled
            @ LordspotError::TallyNotSettled,
    )]
    pub tally_state: Account<'info, TallyState>,

    // The user's ticket — closed after claim, rent returned to signer
    #[account(
        mut,
        seeds = [
            SEED_TICKET,
            epoch_id.to_le_bytes().as_ref(),
            ticket_account.ticket_index.to_le_bytes().as_ref(),
        ],
        bump = ticket_account.bump,
        constraint = ticket_account.owner == signer.key()
            @ LordspotError::InvalidOwner,
        constraint = ticket_account.draw_id == epoch_id
            @ LordspotError::InvalidEpochId,
        constraint = !ticket_account.claimed
            @ LordspotError::AlreadyClaimed,
        close = signer,  // 👈 closes account, returns rent to signer
    )]
    pub ticket_account: Account<'info, TicketAccount>,

    #[account(
        address = USDC_DEVNET_ADDRESS @ LordspotError::InvalidMintAddress
    )]
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    // User's USDC account — receives payout
    #[account(
        mut,
        token::authority = signer,
        token::mint = usdc_mint,
    )]
    pub user_usdc_account: InterfaceAccount<'info, TokenAccount>,

    // Protocol vault — source of payout
    #[account(
        mut,
        seeds = [SEED_PROTOCOL_USDC_ACCOUNT],
        bump = global_state_account.protocol_usdc_vault_bump,
        token::mint = usdc_mint,
        token::authority = global_state_account,
    )]
    pub protocol_usdc_vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}


