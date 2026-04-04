use anchor_lang::prelude::*;
use anchor_spl::associated_token::spl_associated_token_account::solana_program;
use crate::error::LordspotError;
use crate::constants::{NORMAL_SELECTABLE_MARBLE_COUNT, PRECISE_UNIT};
use crate::utility::combinations::choose;



pub fn fisher_yates_draw(
    min:          u8,
    max:          u8,
    count:        u8,
    seed:         [u8; 32],
    nonce_offset: u64,
) -> Result<Vec<u8>> {

    let range_size = (max - min + 1) as usize;
    require!(
        count as usize <= range_size,
        LordspotError::InvalidMarbleConfiguration
    );

    let mut pool: Vec<u8> = (min..=max).collect();
    let mut nonce = nonce_offset;

    for i in (1..range_size).rev() {

        // Loop until rejection sampling finds a fair value
        // Mirrors Solidity's while(true) exactly
        let j: usize = loop {
            let hash = solana_program::hash::hashv(&[
                &seed,
                &nonce.to_le_bytes(),
            ]);
            nonce += 1;

            let rand_u64 = u64::from_le_bytes(
                hash.to_bytes()[..8].try_into().unwrap()
            );

            // Largest multiple of (i+1) that fits in u64
            // Any rand_u64 below this limit is unbiased
            let limit = (u64::MAX / (i as u64 + 1)) * (i as u64 + 1);

            if rand_u64 < limit {
                break (rand_u64 % (i as u64 + 1)) as usize;
            }
            // else: biased value — loop again with new nonce
            // identical to Solidity's while(true) { nonce++; } pattern
        };

        pool.swap(i, j);
        // nonce already incremented inside loop
    }

    Ok(pool[..count as usize].to_vec())
}

pub fn compute_winning_bitvec(
    normal_balls:     &[u8],
    special_ball:      u8,
    normal_marble_max: u8,
) -> Result<([u8; 32], u8)> {

    let mut normals_bitvec = [0u8; 32];

    for &ball in normal_balls {
        let byte_idx = ball as usize / 8;
        let bit_idx  = ball as usize % 8;
        normals_bitvec[byte_idx] |= 1 << bit_idx;
    }

    // Special ball sits above all normal ball bits
    let special_pos = normal_marble_max as usize + special_ball as usize;
    require!(special_pos < 256, LordspotError::InvalidSpecialMarble);

    Ok((normals_bitvec, special_pos as u8))
}


pub fn calculate_special_marble_max(
    new_prize_pool:         u64,
    lp_edge_target:         u64,
    ticket_price:           u64,
    normal_marble_max:      u8,
    special_marble_min:     u8,
    special_marble_hard_cap: u8,
) -> Result<u8> {

    let combos_per_special = choose(
        normal_marble_max as u64,
        NORMAL_SELECTABLE_MARBLE_COUNT as u64,
    ).ok_or(LordspotError::InvalidMarbleConfiguration)?;

    let numerator = (new_prize_pool as u128)
        .checked_mul(PRECISE_UNIT as u128)
        .ok_or(LordspotError::AirthMaticOverflow)?;

    let denominator = (PRECISE_UNIT as u128)
        .checked_sub(lp_edge_target as u128)
        .ok_or(LordspotError::AirthMaticUnderflow)?
        .checked_mul(ticket_price as u128)
        .ok_or(LordspotError::AirthMaticOverflow)?;

    let min_tickets = numerator
        .checked_div(denominator)
        .ok_or(LordspotError::AirthMaticUnderflow)?;

    // ceil division
    let ceil_div = min_tickets
        .checked_add(combos_per_special as u128 - 1)
        .ok_or(LordspotError::AirthMaticOverflow)?
        .checked_div(combos_per_special as u128)
        .ok_or(LordspotError::AirthMaticUnderflow)? as u64;

    // apply minimum then hard cap
    let result = std::cmp::max(special_marble_min as u64, ceil_div)
        .min(special_marble_hard_cap as u64) as u8;

    Ok(result)
}