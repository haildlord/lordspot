import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as anchor from 'https://esm.sh/@coral-xyz/anchor@0.30.1'
import IDL from './lords_pot.json' with { type: "json" };

const coder = new anchor.BorshEventCoder(IDL as anchor.Idl);

function calculateTicketTier(ticketStr: string, winningStr: string, normalMax: number) {
    const ticket = BigInt(ticketStr);
    const winning = BigInt(winningStr);

    const normalMask = (BigInt(1) << BigInt(normalMax + 1)) - BigInt(1);

    let normalOverlap = (ticket & winning) & normalMask;
    let normalMatches = 0;
    while (normalOverlap > BigInt(0)) {
        if ((normalOverlap & BigInt(1)) === BigInt(1)) normalMatches++;
        normalOverlap >>= BigInt(1);
    }

    const bonusMatch = ((ticket & winning) & ~normalMask) !== BigInt(0);
    return (normalMatches * 2) + (bonusMatch ? 1 : 0);
}

function unpackWinningTicket(packedTicketStr: string, normalMax: number) {
    const packedTicket = BigInt(packedTicketStr);
    const normals: number[] = [];
    let bonus = 0;

    for (let i = 1; i <= normalMax; i++) {
        if ((packedTicket & (BigInt(1) << BigInt(i))) !== BigInt(0)) {
            normals.push(i);
        }
    }
    for (let i = 1; i <= 50; i++) {
        if ((packedTicket & (BigInt(1) << BigInt(normalMax + i))) !== BigInt(0)) {
            bonus = i;
            break;
        }
    }
    return { normals, bonus };
}

async function handleGlobalConfigInitialized(supabase: SupabaseClient, eData: any) {
    console.log("Processing GlobalConfigInitialized...");

    const { error } = await supabase
        .from('global_config')
        .upsert({
            id: 1,
            pool_total_cap: eData.pool_total_cap.toString(),
            normal_marble_max: eData.normal_marble_max,
            ticket_price: eData.ticket_price.toString(),
            switchboard_random_account: eData.rngkp.toString(),
            current_epoch_id: eData.current_epoch_id.toString(),
            drawing_duration: eData.drawing_duration.toString(),
            lp_target_percent : eData.lp_target_percent.toString()
        });

    if (error) throw new Error(`GlobalConfig DB Error: ${error.message}`);
    console.log("Global Config Updated Successfully!");
}

async function handleLpActivity(supabase: SupabaseClient, eventName: string, eData: any, signature: string) {
    console.log(`Processing ${eventName} for ${eData.user.toString()}...`);

    let actionType = '';
    let amount = 0;

    const normalizedEventName = eventName.toLowerCase();

    if (normalizedEventName === 'lpdepositedevent') {
        actionType = 'DEPOSIT';
        amount = eData.amount_usdc.toString();
    } else if (normalizedEventName === 'lpwithdrawinitiatedevent') {
        actionType = 'INITIATE_WITHDRAW';
        amount = eData.amount_shares.toString();
    } else if (normalizedEventName === 'lpwithdrawfinalizedevent') {
        actionType = 'FINALIZE_WITHDRAW';
        amount = eData.amount_usdc_claimed.toString();
    }

    const { error } = await supabase
        .from('lp_activity_logs')
        .insert({
            user_address: eData.user.toString(),
            action_type: actionType,
            epoch_id: eData.epoch_id.toString(),
            amount: amount,
            tx_signature: signature
        });

    if (error) {
        if (error.code === '23505') {
            console.log(`Tx ${signature} already logged. Skipping.`);
            return;
        }
        console.error(`❌ LP Activity DB Error: ${error.message}`);
        return;
    }
    console.log(`✅ ${actionType} logged successfully!`);
}

async function handleRandomnessCommitted(supabase: SupabaseClient, eData: any) {
    console.log(`🔒 Processing RandomnessCommittedEvent for Epoch ${eData.epoch_id.toString()}...`);
    const { error } = await supabase
        .from('global_config')
        .update({ is_drawing: true })
        .eq('id', 1);

    if (error) console.error(`❌ DB Error (Commit): ${error.message}`);
}

async function handleWinningTicketDrawn(supabase: SupabaseClient, eData: any, signature: string) {
    console.log(`🎯 Processing WinningTicketDrawnEvent for Epoch ${eData.epoch_id.toString()}...`);

    const epochId = eData.epoch_id.toString();
    const packedTicket = eData.packed_winning_ticket.toString();
    const normalMax = eData.normal_marble_max;

    const { normals, bonus } = unpackWinningTicket(packedTicket, normalMax);

    const { error } = await supabase
        .from('epochs')
        .upsert({
            epoch_id: epochId,
            winning_normals: normals,
            winning_bonus: bonus,
            packed_winning_ticket: packedTicket,
            prize_pool: 0,
            jackpot: 0,
            lp_pool_total: 0,
            tx_signature: signature
        });

    if (error) {
        if (error.code === '23505') {
            console.log(`Tx ${signature} already logged draw. Skipping.`);
            return;
        }
        console.error(`❌ DB Error (Drawn): ${error.message}`);
    }
}

async function handleEpochSettled(supabase: SupabaseClient, eData: any) {
    console.log(`💰 Processing EpochSettledEvent for Epoch ${eData.epoch_id.toString()}...`);

    const epochId = eData.epoch_id.toString();

    const totalWinners = eData.tier_winners.reduce((acc: number, val: any) => acc + Number(val.toString()), 0);

    const { error: epochError } = await supabase.from('epochs').update({
        prize_pool: eData.prize_pool.toString(),
        jackpot: eData.tier_payouts[11].toString(),
        prizes_paid: eData.total_user_payout.toString(),
        total_winners: totalWinners,
        house_earned: eData.house_earned.toString()
    }).eq('epoch_id', epochId);

    if (epochError) console.error(`❌ DB Error (Settle Epochs Update): ${epochError.message}`);

    const tierRows = eData.tier_payouts.map((payout: any, index: number) => ({
        epoch_id: epochId,
        tier_index: index,
        prize_per_ticket: payout.toString(),
        winner_count: Number(eData.tier_winners[index].toString())
    }));

    const { error: tiersError } = await supabase.from('epoch_prize_tiers').insert(tierRows);
    if (tiersError) {
        if (tiersError.code === '23505') {
            console.log(`Epoch ${epochId} tiers already logged. Skipping.`);
            return;
        }
        console.error(`❌ DB Error (Settle Tiers Insert): ${tiersError.message}`);
    }

    console.log("🔍 Assigning payouts to individual user tickets...");

    // FIX 1: Delay added so the Read Replica syncs the newly inserted winning ticket
    await new Promise(resolve => setTimeout(resolve, 2000));

    const { data: epochData } = await supabase.from('epochs').select('packed_winning_ticket').eq('epoch_id', epochId).single();
    const { data: globalData } = await supabase.from('global_config').select('normal_marble_max').eq('id', 1).single();

    if (!epochData || !globalData) {
        console.error("CRITICAL: Failed to fetch Epoch Data or Global Data for ticket grading.");
        return;
    }

    // FIX 2: We MUST select 'id' because it is the Primary Key required for upsert!
    const { data: userTickets } = await supabase.from('ticket_purchases')
        .select('id, signature, packed_ticket, buyer_address, epoch_id, claimed')
        .eq('epoch_id', epochId);

    if (userTickets && userTickets.length > 0) {
        const updates = [];

        for (const t of userTickets) {
            const tier = calculateTicketTier(t.packed_ticket, epochData.packed_winning_ticket, globalData.normal_marble_max);
            const payoutStr = eData.tier_payouts[tier].toString();
            const payout = Number(payoutStr);

            if (payout > 0) {
                updates.push({
                    id: t.id,                 // <-- FIX 2: Include the Primary Key here!
                    signature: t.signature,
                    epoch_id: t.epoch_id,
                    buyer_address: t.buyer_address,
                    packed_ticket: t.packed_ticket,
                    claimed: false,
                    reward: payout
                });
            }
        }

        if (updates.length > 0) {
            const { error: updateErr } = await supabase.from('ticket_purchases').upsert(updates);
            if (updateErr) console.error("❌ Failed to update winning tickets:", updateErr.message);
            else console.log(`🎉 ASSIGNED WINNINGS TO ${updates.length} TICKETS!`);
        } else {
            console.log("😭 No individual tickets won in this epoch.");
        }
    }
}

async function handleEpochStarted(supabase: SupabaseClient, eData: any) {
    console.log(`Processing EpochStartedEvent for Epoch ${eData.epoch_id.toString()}...`);

    const drawingTimeSeconds = Number(eData.drawing_time.toString());
    const isoDrawingDate = new Date(drawingTimeSeconds * 1000).toISOString();

    const { error } = await supabase
        .from('global_config')
        .update({
            current_epoch_id: eData.epoch_id.toString(),
            prize_pool: eData.prize_pool.toString(),
            special_marble_max: eData.special_marble_max,
            next_draw_at: isoDrawingDate,
            total_tickets: eData.total_tickets.toString(),
            is_drawing: false
        })
        .eq('id', 1);

    if (error) {
        console.error(`❌ Epoch Update DB Error: ${error.message}`);
        return;
    }

    console.log(`✅ Epoch ${eData.epoch_id.toString()} started globally! Next draw at: ${isoDrawingDate}`);
}

async function handleTicketsBought(supabase: SupabaseClient, eData: any, signature: string) {
    console.log(`Processing TicketsBoughtEvent for ${eData.buyer.toString()}...`);

    const epochId = eData.epoch_id.toString();
    const buyerAddress = eData.buyer.toString();

    const purchasedCount = eData.packed_tickets.length;

    const rowsToInsert = eData.packed_tickets.map((packedTicket: any, index: number) => {
        return {
            epoch_id: epochId,
            buyer_address: buyerAddress,
            packed_ticket: packedTicket.toString(),
            claimed: false,
            reward: 0,
            signature: `${signature}-${index}`
        };
    });

    const { error } = await supabase
        .from('ticket_purchases')
        .insert(rowsToInsert);

    if (error) {
        if (error.code === '23505') {
            console.log(`Tx ${signature} already logged tickets. Skipping.`);
            return;
        }
        console.error(`❌ Ticket Purchase DB Error: ${error.message}`);
        return;
    }

    const { error: updateError } = await supabase.rpc('increment_total_tickets', {
        increment_amount: purchasedCount
    });

    if (updateError) {
        console.error(`❌ Global Config Update Error: ${updateError.message}`);
        return;
    }

    console.log(`✅ Successfully logged ${rowsToInsert.length} tickets for ${buyerAddress}!`);
}

async function handleTicketClaimed(supabase: SupabaseClient, eData: any) {
    console.log(`🤑 Processing TicketClaimedEvent for ${eData.buyer.toString()}...`);

    const epochId = eData.epoch_id.toString();
    const buyerAddress = eData.buyer.toString();
    const packedTicket = eData.packed_ticket.toString();

    // 1. Find exactly ONE unclaimed ticket matching this description (to handle duplicates safely)
    const { data: tickets } = await supabase
        .from('ticket_purchases')
        .select('id')
        .eq('epoch_id', epochId)
        .eq('buyer_address', buyerAddress)
        .eq('packed_ticket', packedTicket)
        .eq('claimed', false)
        .limit(1);

    // 2. Mark it as claimed!
    if (tickets && tickets.length > 0) {
        const { error } = await supabase
            .from('ticket_purchases')
            .update({ claimed: true })
            .eq('id', tickets[0].id);

        if (error) console.error(`❌ DB Error (Claim Update): ${error.message}`);
        else console.log(`✅ Successfully marked ticket ${tickets[0].id} as CLAIMED!`);
    } else {
        console.log("⚠️ TicketClaimedEvent fired, but no matching unclaimed ticket found in DB.");
    }
}

Deno.serve(async (req) => {
    try {
        const projectUrl = Deno.env.get('PROJECT_URL');
        const serviceKey = Deno.env.get('SERVICE_ROLE_KEY');

        if (!projectUrl || !serviceKey) {
            throw new Error("FATAL: Missing Cloud Keys (PROJECT_URL or SERVICE_ROLE_KEY)");
        }

        const supabase = createClient(projectUrl, serviceKey);

        const payload = await req.json();
        if (!payload || payload.length === 0) {
            return new Response("OK", { status: 200 });
        }

        for (const tx of payload) {
            if (tx.meta?.err) {
                console.log(`Skipping failed tx: ${tx.signature}`);
                continue;
            }

            const logs = tx.meta?.logMessages || [];
            const signature = tx.signature || (tx.transaction?.signatures && tx.transaction.signatures[0]);

            if (!signature) {
                console.log("Could not find transaction signature in payload. Skipping.");
                continue;
            }

            for (const log of logs) {
                if (!log.includes("Program data:")) continue;

                const data = log.split("Program data: ")[1];
                let event;

                try {
                    event = coder.decode(data);
                } catch (decodeError) {
                    continue;
                }

                if (!event) continue;

                console.log(`\n--- CAUGHT EVENT: ${event.name} ---`);

                const eventName = event.name.toLowerCase();

                if (eventName === "globalconfiginitialized") {
                    await handleGlobalConfigInitialized(supabase, event.data);
                } else if (
                    eventName === "lpdepositedevent" ||
                    eventName === "lpwithdrawinitiatedevent" ||
                    eventName === "lpwithdrawfinalizedevent"
                ) {
                    await handleLpActivity(supabase, event.name, event.data, signature);
                } else if (eventName === "randomnesscommittedevent") {
                    await handleRandomnessCommitted(supabase, event.data);
                } else if (eventName === "winningticketdrawnevent") {
                    await handleWinningTicketDrawn(supabase, event.data, signature);
                } else if (eventName === "epochsettledevent") {
                    await handleEpochSettled(supabase, event.data);
                } else if( eventName === "epochstartedevent" ) {
                    await handleEpochStarted(supabase, event.data);
                } else if (eventName === "ticketsboughtevent") {
                    await handleTicketsBought(supabase, event.data, signature);
                } else if (eventName === "ticketclaimedevent") {
                    await handleTicketClaimed(supabase, event.data);
                } else {
                    console.log(`Ignored untracked event: ${event.name}`);
                }
            }
        }

        return new Response("Processed successfully", { status: 200 });

    } catch (err: any) {
        console.error("CAUGHT FATAL ERROR:", err.message);
        return new Response(`Error caught: ${err.message}`, { status: 200 });
    }
});