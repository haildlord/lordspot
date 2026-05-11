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
}

async function handleLpActivity(supabase: SupabaseClient, eventName: string, eData: any, signature: string) {
    console.log(`Processing ${eventName} for ${eData.user.toString()}...`);
    let actionType = '';
    let amount = 0;
    let unit = 'USDC';

    const normalizedEventName = eventName.toLowerCase();
    if (normalizedEventName === 'lpdepositedevent') {
        actionType = 'DEPOSIT';
        amount = eData.amount_usdc.toString();
        unit = 'USDC';
    } else if (normalizedEventName === 'lpwithdrawinitiatedevent') {
        actionType = 'INITIATE_WITHDRAW';
        amount = eData.amount_shares.toString();
        unit = 'SHARES';
    } else if (normalizedEventName === 'lpwithdrawfinalizedevent') {
        actionType = 'FINALIZE_WITHDRAW';
        amount = eData.amount_usdc_claimed.toString();
        unit = 'USDC';
    }

    const { error } = await supabase.from('lp_activity_logs').insert({
        user_address: eData.user.toString(),
        action_type: actionType,
        epoch_id: eData.epoch_id.toString(),
        amount: amount,
        unit: unit,
        tx_signature: signature
    });

    if (error && error.code !== '23505') console.error(`❌ LP Activity DB Error: ${error.message}`);
}

// ============================================================================
// THE ZOMBIE WEBHOOK KILLER
// ============================================================================
async function handleRandomnessCommitted(supabase: SupabaseClient, eData: any) {
    const epochIdStr = eData.epoch_id.toString();
    console.log(`🔒 Processing RandomnessCommittedEvent for Epoch ${epochIdStr}...`);

    // 1. Check if this epoch has already been drawn/settled in the database!
    const { data: existingEpoch } = await supabase
        .from('epochs')
        .select('epoch_id')
        .eq('epoch_id', epochIdStr)
        .single();

    // 2. If it exists in the 'epochs' table, it is old. KILL IT.
    if (existingEpoch) {
        console.log(`🛡️ GHOST WEBHOOK KILLED: Epoch ${epochIdStr} is already finished. Ignoring old commit event.`);
        return; // EXIT EARLY! Do not lock the UI.
    }

    // 3. Otherwise, it is a fresh drawing. Lock the UI.
    const { error } = await supabase
        .from('global_config')
        .update({ is_drawing: true })
        .eq('id', 1);

    if (error) console.error(`❌ DB Error (Commit): ${error.message}`);
    else console.log(`✅ UI Locked for Epoch ${epochIdStr}`);
}

async function handleWinningTicketDrawn(supabase: SupabaseClient, eData: any, signature: string) {
    console.log(`🎯 Processing WinningTicketDrawnEvent for Epoch ${eData.epoch_id.toString()}...`);
    const epochId = eData.epoch_id.toString();
    const packedTicket = eData.packed_winning_ticket.toString();
    const { normals, bonus } = unpackWinningTicket(packedTicket, eData.normal_marble_max);

    const { error } = await supabase.from('epochs').upsert({
        epoch_id: epochId,
        winning_normals: normals,
        winning_bonus: bonus,
        packed_winning_ticket: packedTicket,
        prize_pool: 0, jackpot: 0, lp_pool_total: 0,
        tx_signature: signature
    });
    if (error && error.code !== '23505') console.error(`❌ DB Error (Drawn): ${error.message}`);
}

async function handleEpochSettled(supabase: SupabaseClient, eData: any) {
    console.log(`💰 Processing EpochSettledEvent for Epoch ${eData.epoch_id.toString()}...`);
    const epochId = eData.epoch_id.toString();
    const totalWinners = eData.tier_winners.reduce((acc: number, val: any) => acc + Number(val.toString()), 0);

    await supabase.from('epochs').update({
        prize_pool: eData.prize_pool.toString(),
        jackpot: eData.tier_payouts[11].toString(),
        prizes_paid: eData.total_user_payout.toString(),
        total_winners: totalWinners,
        house_earned: eData.house_earned.toString()
    }).eq('epoch_id', epochId);

    const tierRows = eData.tier_payouts.map((payout: any, index: number) => ({
        epoch_id: epochId,
        tier_index: index,
        prize_per_ticket: payout.toString(),
        winner_count: Number(eData.tier_winners[index].toString())
    }));
    await supabase.from('epoch_prize_tiers').insert(tierRows);

    console.log("🔍 Assigning payouts to individual user tickets...");
    await new Promise(resolve => setTimeout(resolve, 2000));

    const { data: epochData } = await supabase.from('epochs').select('packed_winning_ticket').eq('epoch_id', epochId).single();
    const { data: globalData } = await supabase.from('global_config').select('normal_marble_max').eq('id', 1).single();

    if (!epochData || !globalData) return console.error("CRITICAL: Failed to fetch data for ticket grading.");

    const { data: userTickets } = await supabase.from('ticket_purchases').select('id, signature, packed_ticket, buyer_address, epoch_id, claimed').eq('epoch_id', epochId);

    if (userTickets && userTickets.length > 0) {
        const updates = [];
        for (const t of userTickets) {
            try {
                if (!t.packed_ticket) continue;
                const tier = calculateTicketTier(t.packed_ticket, epochData.packed_winning_ticket, globalData.normal_marble_max);
                const payout = Number(eData.tier_payouts[tier].toString());
                if (payout > 0) {
                    updates.push({
                        id: t.id, signature: t.signature, epoch_id: t.epoch_id,
                        buyer_address: t.buyer_address, packed_ticket: t.packed_ticket,
                        claimed: false, reward: payout
                    });
                }
            } catch (gradeErr) {
                console.error(`Failed to grade ticket ${t.id}:`, gradeErr);
            }
        }
        if (updates.length > 0) await supabase.from('ticket_purchases').upsert(updates);
    }
}

async function handleEpochStarted(supabase: SupabaseClient, eData: any) {
    console.log(`Processing EpochStartedEvent for Epoch ${eData.epoch_id.toString()}...`);
    const isoDrawingDate = new Date(Number(eData.drawing_time.toString()) * 1000).toISOString();

    const { error } = await supabase.from('global_config').update({
        current_epoch_id: eData.epoch_id.toString(),
        prize_pool: eData.prize_pool.toString(),
        special_marble_max: eData.special_marble_max,
        next_draw_at: isoDrawingDate,
        total_tickets: eData.total_tickets.toString(),
        is_drawing: false // UNLOCKS THE UI
    }).eq('id', 1);

    if (error) console.error(`❌ Epoch Update DB Error: ${error.message}`);
    else console.log(`✅ Epoch ${eData.epoch_id.toString()} started globally!`);
}

async function handleTicketsBought(supabase: SupabaseClient, eData: any, signature: string) {
    const epochId = eData.epoch_id.toString();
    const rowsToInsert = eData.packed_tickets.map((packedTicket: any, index: number) => ({
        epoch_id: epochId, buyer_address: eData.buyer.toString(), packed_ticket: packedTicket.toString(),
        claimed: false, reward: 0, signature: `${signature}-${index}`
    }));
    await supabase.from('ticket_purchases').insert(rowsToInsert);
    await supabase.rpc('increment_total_tickets', { increment_amount: eData.packed_tickets.length });
}

async function handleTicketClaimed(supabase: SupabaseClient, eData: any) {
    const { data: tickets } = await supabase.from('ticket_purchases').select('id').eq('epoch_id', eData.epoch_id.toString()).eq('buyer_address', eData.buyer.toString()).eq('packed_ticket', eData.packed_ticket.toString()).eq('claimed', false).limit(1);
    if (tickets && tickets.length > 0) await supabase.from('ticket_purchases').update({ claimed: true }).eq('id', tickets[0].id);
}

Deno.serve(async (req) => {
    try {
        const projectUrl = Deno.env.get('PROJECT_URL');
        const serviceKey = Deno.env.get('SERVICE_ROLE_KEY');
        if (!projectUrl || !serviceKey) throw new Error("FATAL: Missing Cloud Keys");

        const supabase = createClient(projectUrl, serviceKey);
        const payload = await req.json();
        if (!payload || payload.length === 0) return new Response("OK", { status: 200 });

        for (const tx of payload) {
            if (tx.meta?.err) continue;
            const logs = tx.meta?.logMessages || [];
            const signature = tx.signature || (tx.transaction?.signatures && tx.transaction.signatures[0]);
            if (!signature) continue;

            for (const log of logs) {
                if (!log.includes("Program data:")) continue;
                const data = log.split("Program data: ")[1];
                let event;
                try { event = coder.decode(data); } catch (e) { continue; }
                if (!event) continue;

                const eventName = event.name.toLowerCase();

                // BULLETPROOF EVENT PROCESSOR: If one fails, the next still runs!
                try {
                    if (eventName === "globalconfiginitialized") await handleGlobalConfigInitialized(supabase, event.data);
                    else if (["lpdepositedevent", "lpwithdrawinitiatedevent", "lpwithdrawfinalizedevent"].includes(eventName)) await handleLpActivity(supabase, event.name, event.data, signature);
                    else if (eventName === "randomnesscommittedevent") await handleRandomnessCommitted(supabase, event.data);
                    else if (eventName === "winningticketdrawnevent") await handleWinningTicketDrawn(supabase, event.data, signature);
                    else if (eventName === "epochsettledevent") await handleEpochSettled(supabase, event.data);
                    else if (eventName === "epochstartedevent") await handleEpochStarted(supabase, event.data);
                    else if (eventName === "ticketsboughtevent") await handleTicketsBought(supabase, event.data, signature);
                    else if (eventName === "ticketclaimedevent") await handleTicketClaimed(supabase, event.data);
                } catch (eventProcessingError: any) {
                    console.error(`💥 CRASH PREVENTED in event ${eventName}!`);
                    console.error(`Stack Trace:`, eventProcessingError.stack || eventProcessingError.message);
                }
            }
        }
        return new Response("Processed successfully", { status: 200 });
    } catch (err: any) {
        console.error("CAUGHT FATAL ERROR:", err.message);
        return new Response(`Error caught: ${err.message}`, { status: 200 });
    }
});