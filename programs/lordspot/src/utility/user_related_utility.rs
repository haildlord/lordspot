use anchor_lang::prelude::*;
use crate::constants::{NORMAL_SELECTABLE_MARBLE_COUNT};
use crate::error::LordspotError;
use crate::state::{DrawingState, GlobalState, TicketTracker, UserTickets};
use crate::instructions::user_interactions_instructions::TicketInput;

pub fn _validate_and_store_tickets<'info>(
    global_state: &Account<'info, GlobalState>,
    ticket_tracker: &mut Account<'info, TicketTracker>,
    user_tickets: &mut Account<'info, UserTickets>,
    drawing: &mut Account<'info, DrawingState>,
    tickets: &[TicketInput],
) -> Result<()> {
    let edge = global_state.edge_per_ticket;
    let net_per_ticket = global_state.ticket_price
        .checked_sub(edge)
        .ok_or(LordspotError::AirthMaticUnderflow)?;

    let mut extra_to_prize = 0u64;

    for ticket_input in tickets {
        require!(
            ticket_input.normal_marbles.len() == NORMAL_SELECTABLE_MARBLE_COUNT as usize,
            LordspotError::InvalidNormalsCount
        );

        let mut seen = [false; 256];
        for &ball in &ticket_input.normal_marbles {
            if ball == 0 || ball > global_state.normal_marble_max || seen[ball as usize] {
                return Err(LordspotError::DuplicateMarble.into());
            }
            seen[ball as usize] = true;
        }

        require!(
            ticket_input.special_marble >= 1 && ticket_input.special_marble <= drawing.special_marble_max,
            LordspotError::InvalidSpecialMarble
        );

        let packed = pack_ticket(
            &ticket_input.normal_marbles,
            ticket_input.special_marble,
            global_state.normal_marble_max,
        );
        
        let is_dup = ticket_tracker.unique_tickets.contains(&packed);

        if is_dup {
            extra_to_prize = extra_to_prize
                .checked_add(net_per_ticket)
                .ok_or(LordspotError::AirthMaticOverflow)?;

            // Route to duplicate bucket
            ticket_tracker.duplicate_tickets.push(packed);
        } else {
            // Route to unique bucket
            ticket_tracker.unique_tickets.push(packed);
        }

        // Keep user tracking the same
        user_tickets.tickets.push(packed);
        user_tickets.claimed.push(false);
    }

    drawing.prize_pool = drawing.prize_pool
        .checked_add(extra_to_prize)
        .ok_or(LordspotError::AirthMaticOverflow)?;

    Ok(())
}

// Packs a ticket (5 normal balls + 1 bonus ball) into a single u64
// This is deterministic and unique for each combination (fits easily in 64 bits)
// ! : soft cap limit of 65 vs `u64` bit flip, will it overflow -- this is a 100% bug
pub fn pack_ticket(
    normal_marbles: &[u8],   // exactly 5 numbers
    special_marble: u8,
    normal_max: u8,          // usually 30
) -> u64 {

    let mut packed: u64 = 0;

    // 1. Pack normal balls as bits (low 32 bits are enough for max=30)
    for &ball in normal_marbles {
        packed |= 1u64 << (ball as u64);
    }

    // 2. Pack bonus ball in higher bits (after the normal balls)
    // normal_max is usually 30, bonus up to 80 → total bits used ~ 30 + 7 = 37 bits
    let bonus_pos = normal_max as u64 + special_marble as u64;
    packed |= 1u64 << bonus_pos;

    packed
}

