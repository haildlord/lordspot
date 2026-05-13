use anchor_lang::prelude::*;
use crate::constants::{NORMAL_SELECTABLE_MARBLE_COUNT};
use crate::error::LordspotError;
use crate::state::{DrawingState, GlobalState, TicketTracker, UserTickets};
use crate::instructions::user_interactions_instructions::TicketInput;

pub fn _validate_and_store_tickets(
    global_state: &Account<GlobalState>,
    ticket_tracker: &mut Account<TicketTracker>,
    user_tickets: &mut Account<UserTickets>,
    drawing: &mut Account<DrawingState>,
    tickets: &[TicketInput],
) -> Result<Vec<u64>> {
    let edge = global_state.edge_per_ticket;
    let net_per_ticket = global_state.ticket_price
        .checked_sub(edge)
        .ok_or(LordspotError::AirthMaticUnderflow)?;

    let mut extra_to_prize = 0u64;

    let mut packed_tickets = Vec::with_capacity(tickets.len());

    for ticket_input in tickets {
        require!(
            ticket_input.normal_marbles.len() == NORMAL_SELECTABLE_MARBLE_COUNT as usize,
            LordspotError::InvalidNormalsCount
        );

        let mut previous_ball = 0u8; // Start at 0

        for &ball in &ticket_input.normal_marbles {
            // 1. Check for Out of Bounds first
            if ball == 0 || ball > global_state.normal_marble_max {
                return Err(LordspotError::InvalidMarble.into());
            }

            // 2. Specifically catch duplicates
            if ball == previous_ball {
                return Err(LordspotError::DuplicateMarble.into());
            }

            // 3. Specifically catch unsorted (out of order) numbers
            if ball < previous_ball {
                return Err(LordspotError::UnsortedMarbles.into());
            }

            // 4. Update previous_ball for the next loop iteration
            previous_ball = ball;
        }

        require!(
            ticket_input.special_marble >= 1 && ticket_input.special_marble <= drawing.special_marble_max,
            LordspotError::InvalidSpecialMarble
        );

        let packed = pack_ticket(
            &ticket_input.normal_marbles,
            ticket_input.special_marble,
            global_state.normal_marble_max,
        )?;
        
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

        packed_tickets.push(packed);
    }

    drawing.prize_pool = drawing.prize_pool
        .checked_add(extra_to_prize)
        .ok_or(LordspotError::AirthMaticOverflow)?;

    Ok(packed_tickets)
}

pub fn pack_ticket(
    normal_marbles: &[u8],
    special_marble: u8,
    normal_max: u8,
) -> Result<u64> {

    let mut packed: u64 = 0;

    for &ball in normal_marbles {
        packed |= 1u64 << (ball as u64);
    }

    let bonus_pos = normal_max as u64 + special_marble as u64;

    require!(bonus_pos < 64, LordspotError::AirthMaticOverflow); // Prevent bit-shift panics

    packed |= 1u64 << bonus_pos;

    Ok(packed)
}

