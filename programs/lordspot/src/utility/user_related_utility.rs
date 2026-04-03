use anchor_lang::prelude::*;
use anchor_lang::Discriminator;
use crate::constants::{SEED_TICKET, NORMAL_SELECTABLE_MARBLE_COUNT};
use crate::error::LordspotError;
use crate::state::{DrawingState, GlobalState, TicketAccount};
use crate::instructions::user_interactions_instructions::TicketInput;



pub fn _validate_and_store_tickets<'info>(
    // From ctx.accounts — passed individually to avoid lifetime conflicts
    global_state: &Account<'info, GlobalState>,
    signer:          &Signer<'info>,
    drawing:         &Account<'info, DrawingState>,
    system_program:  &Program<'info, System>,
    epoch_id:        u64,
    starting_index:  u64,
    tickets:         &[TicketInput],
    remaining: &'info [AccountInfo<'info>],
    program_id:      &Pubkey,
) -> Result<()> {

    let epoch_bytes = epoch_id.to_le_bytes();

    for (i, ticket_input) in tickets.iter().enumerate() {

        // --- Validate balls ---
        require!(
            ticket_input.normal_marbles.len() == NORMAL_SELECTABLE_MARBLE_COUNT as usize,
            LordspotError::InvalidNormalsCount
        );

        require!(
            ticket_input.special_marble >= 1
            && ticket_input.special_marble <= drawing.special_marble_max,
            LordspotError::InvalidSpecialMarble
        );

        // --- Compute bitvec on-chain ---
        // Catches: ball out of range, duplicate balls in same ticket
        let bitvec = compute_bitvec(
            &ticket_input.normal_marbles,
            ticket_input.special_marble,
            global_state.normal_marble_max,
        )?;

        // --- Unique global index for this ticket ---
        // starting_index + i guarantees uniqueness:
        //   same user, same combo, same tx  → i differs     → different PDA
        //   same user, same combo, diff tx  → starting differs → different PDA
        let ticket_index = starting_index
            .checked_add(i as u64)
            .ok_or(LordspotError::AirthMaticOverflow)?;

        let ticket_index_bytes = ticket_index.to_le_bytes();

        // --- Derive PDA and verify caller passed correct account ---
        let (expected_pda, bump) = Pubkey::find_program_address(
            &[
                SEED_TICKET,
                &epoch_bytes,
                &ticket_index_bytes,
            ],
            program_id,
        );

        let ticket_info = &remaining[i];

        require!(
            ticket_info.key() == expected_pda,
            LordspotError::TicketAccountMismatch
        );

        // --- Create the PDA account ---
        let rent     = Rent::get()?;
        let lamports = rent.minimum_balance(TicketAccount::LEN);

        anchor_lang::system_program::create_account(
            CpiContext::new_with_signer(
                system_program.to_account_info(),
                anchor_lang::system_program::CreateAccount {
                    from: signer.to_account_info(),
                    to:   ticket_info.clone(),
                },
                &[&[
                    SEED_TICKET,
                    &epoch_bytes,
                    &ticket_index_bytes,
                    &[bump],
                ]],
            ),
            lamports,
            TicketAccount::LEN as u64,
            program_id,
        )?;

        // --- Write data into the new account ---
        let ticket_data = TicketAccount {
            owner:        signer.key(),
            draw_id:      epoch_id,
            bitvec,
            ticket_index,
            claimed:      false,
            bump,
        };

        let mut data= ticket_info.try_borrow_mut_data()?;
        let discriminator = TicketAccount::DISCRIMINATOR;

        data[..8].copy_from_slice(&discriminator);

        let encoded = ticket_data.try_to_vec()?;

        data[8..8 + encoded.len()].copy_from_slice(&encoded);
    }

    Ok(())
}


fn compute_bitvec(
    normal_marbles: &[u8],
    special_marble:  u8,
    marble_max:      u8,
) -> Result<[u8; 32]> {

    let mut bitvec = [0u8; 32];

    for &ball in normal_marbles {
        // Ball must be in range 1..=marble_max
        require!(
            ball >= 1 && ball <= marble_max,
            LordspotError::InvalidMarble
        );

        let byte_idx = ball as usize / 8;
        let bit_idx  = ball as usize % 8;

        // If bit already set — user passed duplicate ball
        require!(
            bitvec[byte_idx] & (1 << bit_idx) == 0,
            LordspotError::DuplicateMarble
        );

        bitvec[byte_idx] |= 1 << bit_idx;
    }

    // Special marble sits at bit position (marble_max + special_marble)
    // Matches EVM encoding exactly
    let special_pos = marble_max as usize + special_marble as usize;

    require!(
        special_pos < 256,
        LordspotError::InvalidSpecialMarble
    );

    bitvec[special_pos / 8] |= 1 << (special_pos % 8);

    Ok(bitvec)
}

