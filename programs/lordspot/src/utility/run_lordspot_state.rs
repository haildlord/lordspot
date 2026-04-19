use anchor_lang::prelude::*;
use crate::error::LordspotError;
use crate::constants::{NORMAL_SELECTABLE_MARBLE_COUNT, PRECISE_UNIT, MIN_PAYOUT, PREMIUM_TIER_MIN_ALLOCATION, MIN_PAYOUT_TIERS, PREMIUM_TIER_WEIGHTS};
use crate::utility::combinations::choose;
use solana_program::hash::hashv;

pub fn fisher_yates_draw(
    seed: [u8; 32],
    min_range: u8,
    max_range: u8,
    count: u8,
) -> Result<Vec<u8>> {
    let range_size = (max_range - min_range + 1) as usize;
    let mut pool: Vec<u8> = (min_range..=max_range).collect();
    let mut nonce: u64 = 0;

    for i in (1..range_size).rev() {
        let mut rand_idx: u64;

        loop {
            // 🛡️ Standard SHA256 hashing (same as Keccak for our needs)
            let hash = hashv(&[
                &seed,
                &nonce.to_le_bytes(),
            ]);

            let hash_bytes = hash.to_bytes();

            let mut buf = [0u8; 8];
            buf.copy_from_slice(&hash_bytes[0..8]);
            let rand_val = u64::from_le_bytes(buf);

            let limit = (u64::MAX / (i as u64 + 1)) * (i as u64 + 1);

            if rand_val < limit {
                rand_idx = rand_val % (i as u64 + 1);
                break;
            }
            nonce += 1;
        }

        pool.swap(i, rand_idx as usize);
        nonce += 1;
    }

    Ok(pool[0..count as usize].to_vec())
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

pub fn calculate_tier_total_winning_combos(
    matches: u64,
    normal_max: u8,
    special_max: u8,
    special_match: bool,
) -> u64 {
    let c1 = choose(NORMAL_SELECTABLE_MARBLE_COUNT as u64, matches).unwrap_or(0);
    let c2 = choose((normal_max as u64).saturating_sub(NORMAL_SELECTABLE_MARBLE_COUNT as u64), NORMAL_SELECTABLE_MARBLE_COUNT as u64 - matches).unwrap_or(0);

    if special_match {
        c1 * c2
    } else {
        c1 * c2 * ((special_max as u64).saturating_sub(1))
    }
}

pub fn calculate_tier_winners_and_payouts(
    prize_pool: u64,
    normal_max: u8,
    bonus_max: u8,
    unique_per_tier: &[u64; 12], // Updated parameter
    dup_per_tier: &[u64; 12],    // Updated parameter
) -> ([u64; 12], u64) {

    let mut tier_winners = [0u64; 12];
    let mut min_payout_alloc = 0u64;

    for i in 0..12usize {
        let matches = i / 2;
        let bonus_match = i % 2 == 1;

        if !MIN_PAYOUT_TIERS[i] && PREMIUM_TIER_WEIGHTS[i] == 0 {
            continue;
        }

        let combo_tickets = calculate_tier_total_winning_combos(
            matches as u64,
            normal_max,
            bonus_max,
            bonus_match,
        );

        tier_winners[i] = combo_tickets + dup_per_tier[i];

        if MIN_PAYOUT_TIERS[i] {
            min_payout_alloc = min_payout_alloc
                .checked_add(tier_winners[i].checked_mul(MIN_PAYOUT).unwrap_or(0))
                .unwrap_or(0);
        }
    }

    let premium_min_alloc = prize_pool
        .checked_mul(PREMIUM_TIER_MIN_ALLOCATION)
        .unwrap_or(0)
        .checked_div(PRECISE_UNIT)
        .unwrap_or(0);

    let use_minimum_payouts = premium_min_alloc + min_payout_alloc < prize_pool;

    let remaining = if use_minimum_payouts {
        prize_pool - min_payout_alloc
    } else {
        prize_pool
    };

    let mut tier_payouts = [0u64; 12];
    let mut total_user_payout = 0u64;

    for i in 0..12usize {
        if tier_winners[i] == 0 {
            continue;
        }

        let premium_amount = remaining
            .checked_mul(PREMIUM_TIER_WEIGHTS[i])
            .unwrap_or(0)
            .checked_div(PRECISE_UNIT)
            .unwrap_or(0)
            .checked_div(tier_winners[i])
            .unwrap_or(0);

        let per_ticket = if MIN_PAYOUT_TIERS[i] {
            MIN_PAYOUT + premium_amount
        } else {
            premium_amount
        };

        tier_payouts[i] = per_ticket;

        let real_user_tickets = unique_per_tier[i] + dup_per_tier[i];

        total_user_payout = total_user_payout
            .checked_add(per_ticket.checked_mul(real_user_tickets).unwrap_or(0))
            .unwrap_or(0);
    }

    (tier_payouts, total_user_payout)
}

pub fn calculate_ticket_tier(
    ticket: u64,
    winning: u64,
    normal_max: u8,
) -> u8 {
    // 1. Create a mask for just the normal balls (bits 1 to 30)
    // This creates a number with 1s in the first 31 positions
    let normal_mask = (1u64 << (normal_max as u64 + 1)) - 1;

    // 2. Count matches ONLY in the normal zone
    let normal_matches = ((ticket & winning) & normal_mask).count_ones() as u8;

    // 3. Check if they matched in the bonus zone (anything above bit 30)
    // We don't need the ball value; we just check if any bit in the bonus zone overlaps
    let bonus_match = ((ticket & winning) & !normal_mask) != 0;

    // 4. Calculate the Tier Index (0-11)
    (normal_matches * 2) + if bonus_match { 1 } else { 0 }
}