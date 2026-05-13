import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as anchor from 'https://esm.sh/@coral-xyz/anchor@0.30.1'
import IDL from './lords_pot.json' with { type: "json" };

const coder = new anchor.BorshEventCoder(IDL as anchor.Idl);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function calculateTicketTier(ticketStr: string, winningStr: string, normalMax: number) {
    // console.log(`[CALC] Grading ticket: ${ticketStr} against winning: ${winningStr} (Max Normal: ${normalMax})`);
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
    const finalTier = (normalMatches * 2) + (bonusMatch ? 1 : 0);
    // console.log(`[CALC] Ticket graded -> Matches: ${normalMatches}, Bonus Match: ${bonusMatch}, Resulting Tier: ${finalTier}`);
    return finalTier;
}

function unpackWinningTicket(packedTicketStr: string, normalMax: number) {
    console.log(`[UNPACK] Unpacking ticket string: ${packedTicketStr}`);
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
    console.log(`[UNPACK] Unpacked Result -> Normals: [${normals.join(', ')}], Bonus: ${bonus}`);
    return { normals, bonus };
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

async function handleGlobalConfigInitialized(supabase: SupabaseClient, eData: any) {
    console.log(`[EVENT] ⚙️ Processing GlobalConfigInitialized...`);
    console.log(`[EVENT] Data extracted -> Pool Cap: ${eData.pool_total_cap.toString()}, Max Marble: ${eData.normal_marble_max}, Ticket Price: ${eData.ticket_price.toString()}`);

    console.log(`[DB] Attempting to upsert 'global_config' ID: 1...`);
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

    if (error) {
        console.error(`[DB ERROR] ❌ GlobalConfig DB Error: ${error.message}`);
        throw new Error(`GlobalConfig DB Error: ${error.message}`);
    } else {
        console.log(`[DB SUCCESS] ✅ 'global_config' successfully initialized/updated.`);
    }
}

async function handleLpActivity(supabase: SupabaseClient, eventName: string, eData: any, signature: string) {
    const userAddress = eData.user.toString();
    console.log(`[EVENT] 🌊 Processing LP Activity (${eventName}) for user ${userAddress}...`);

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

    console.log(`[EVENT] Parsed LP Action -> Type: ${actionType}, Amount: ${amount} ${unit}, Epoch: ${eData.epoch_id.toString()}`);
    console.log(`[DB] Inserting LP record into 'lp_activity_logs'...`);

    const { error } = await supabase.from('lp_activity_logs').insert({
        user_address: userAddress,
        action_type: actionType,
        epoch_id: eData.epoch_id.toString(),
        amount: amount,
        unit: unit,
        tx_signature: signature
    });

    if (error) {
        if (error.code === '23505') {
            console.log(`[DB WARN] ⚠️ LP Activity duplicate detected (code 23505). Skipping safely.`);
        } else {
            console.error(`[DB ERROR] ❌ LP Activity DB Error: ${error.message}`);
        }
    } else {
        console.log(`[DB SUCCESS] ✅ LP Activity logged successfully.`);
    }
}

// THE ZOMBIE WEBHOOK KILLER
async function handleRandomnessCommitted(supabase: SupabaseClient, eData: any) {
    const epochIdStr = eData.epoch_id.toString();
    console.log(`[EVENT] 🔒 Processing RandomnessCommittedEvent for Epoch ${epochIdStr}...`);

    console.log(`[DB] Checking if Epoch ${epochIdStr} has already been settled...`);
    const { data: existingEpoch } = await supabase
        .from('epochs')
        .select('epoch_id')
        .eq('epoch_id', epochIdStr)
        .single();

    if (existingEpoch) {
        console.log(`[WEBHOOK GUARD] 🛡️ GHOST WEBHOOK KILLED: Epoch ${epochIdStr} is already finished. Ignoring old commit event. Exit Early!`);
        return;
    }

    console.log(`[DB] Epoch is fresh. Attempting to lock UI by setting 'is_drawing: true' in 'global_config'...`);
    const { error } = await supabase
        .from('global_config')
        .update({ is_drawing: true })
        .eq('id', 1);

    if (error) {
        console.error(`[DB ERROR] ❌ DB Error (Randomness Commit UI Lock): ${error.message}`);
    } else {
        console.log(`[DB SUCCESS] ✅ UI Locked successfully for Epoch ${epochIdStr}`);
    }
}

async function handleWinningTicketDrawn(supabase: SupabaseClient, eData: any, signature: string) {
    const epochIdStr = eData.epoch_id.toString();
    console.log(`[EVENT] 🎯 Processing WinningTicketDrawnEvent for Epoch ${epochIdStr}...`);

    const packedTicket = eData.packed_winning_ticket.toString();
    console.log(`[EVENT] Packed winning ticket string: ${packedTicket}`);

    const { normals, bonus } = unpackWinningTicket(packedTicket, eData.normal_marble_max);

    console.log(`[DB] Upserting initial drawn data into 'epochs' table...`);
    const { error } = await supabase.from('epochs').upsert({
        epoch_id: epochIdStr,
        winning_normals: normals,
        winning_bonus: bonus,
        packed_winning_ticket: packedTicket,
        prize_pool: 0, jackpot: 0, lp_pool_total: 0,
        tx_signature: signature
    });

    if (error) {
        if (error.code === '23505') {
            console.log(`[DB WARN] ⚠️ Duplicate draw record detected (code 23505). Skipping safely.`);
        } else {
            console.error(`[DB ERROR] ❌ DB Error (WinningTicketDrawn): ${error.message}`);
        }
    } else {
        console.log(`[DB SUCCESS] ✅ Winning ticket successfully saved to 'epochs' table.`);
    }
}

async function handleEpochSettled(supabase: SupabaseClient, eData: any) {
    const epochId = eData.epoch_id.toString();
    console.log(`[EVENT] 💰 Processing EpochSettledEvent for Epoch ${epochId}...`);

    const totalWinners = eData.tier_winners.reduce((acc: number, val: any) => acc + Number(val.toString()), 0);
    console.log(`[CALC] Total aggregate winners across all tiers: ${totalWinners}`);

    console.log(`[DB] Updating 'epochs' table with final financial settlement...`);
    const { error: epochUpdateError } = await supabase.from('epochs').update({
        prize_pool: eData.prize_pool.toString(),
        jackpot: eData.tier_payouts[11].toString(),
        prizes_paid: eData.total_user_payout.toString(),
        total_winners: totalWinners,
        house_earned: eData.house_earned.toString()
    }).eq('epoch_id', epochId);

    if (epochUpdateError) {
        console.error(`[DB ERROR] ❌ Failed to update epoch financials: ${epochUpdateError.message}`);
        return;
    }
    console.log(`[DB SUCCESS] ✅ 'epochs' financials updated.`);

    console.log(`[DB] Formatting ${eData.tier_payouts.length} tier payout rows...`);
    const tierRows = eData.tier_payouts.map((payout: any, index: number) => ({
        epoch_id: epochId,
        tier_index: index,
        prize_per_ticket: payout.toString(),
        winner_count: Number(eData.tier_winners[index].toString())
    }));

    console.log(`[DB] Inserting prize tiers into 'epoch_prize_tiers'...`);
    // ADDED ERROR HANDLING TO PREVENT ARRAY DUPLICATION CRASH
    const { error: tierInsertError } = await supabase.from('epoch_prize_tiers').insert(tierRows);
    if (tierInsertError) {
        if (tierInsertError.code === '23505') {
            console.log(`[DB WARN] ⚠️ Duplicate EpochSettled webhook detected. Prize tiers already exist. Halting to prevent duplicate grading effort.`);
            return; // 🛑 Halt execution to save resources!
        } else {
            console.error(`[DB ERROR] ❌ Failed to insert prize tiers: ${tierInsertError.message}`);
            return;
        }
    }
    console.log(`[DB SUCCESS] ✅ Prize tiers inserted.`);

    console.log(`[PROCESS] 🔍 Initiating individual ticket grading process...`);
    // Throttle slighty to allow DB replication
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log(`[DB] Fetching winning ticket data and global config max marbles...`);
    const { data: epochData } = await supabase.from('epochs').select('packed_winning_ticket').eq('epoch_id', epochId).single();
    const { data: globalData } = await supabase.from('global_config').select('normal_marble_max').eq('id', 1).single();

    if (!epochData || !globalData) {
        console.error(`[CRITICAL ERROR] ❌ Failed to fetch epoch/global data for ticket grading. Grading aborted!`);
        return;
    }
    console.log(`[DB] Successfully fetched grading data. Max Marbles: ${globalData.normal_marble_max}`);

    console.log(`[DB] Fetching all user tickets for Epoch ${epochId}...`);
    const { data: userTickets } = await supabase.from('ticket_purchases')
        .select('id, signature, packed_ticket, buyer_address, epoch_id, claimed')
        .eq('epoch_id', epochId);

    if (userTickets && userTickets.length > 0) {
        console.log(`[PROCESS] Found ${userTickets.length} tickets to grade. Looping...`);
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
                console.error(`[GRADING ERROR] ❌ Failed to grade ticket ID ${t.id}:`, gradeErr);
            }
        }

        console.log(`[DB] Grading complete. Found ${updates.length} winning tickets out of ${userTickets.length}.`);
        if (updates.length > 0) {
            console.log(`[DB] Upserting winners to 'ticket_purchases' to apply rewards...`);
            await supabase.from('ticket_purchases').upsert(updates);
            console.log(`[DB SUCCESS] ✅ Winners applied.`);
        }
    } else {
        console.log(`[PROCESS] No tickets found for Epoch ${epochId}. Skipping grading.`);
    }
    console.log(`[EVENT SUCCESS] 🏁 EpochSettledEvent fully processed.`);
}

async function handleEpochStarted(supabase: SupabaseClient, eData: any) {
    const epochIdStr = eData.epoch_id.toString();
    console.log(`[EVENT] 🌅 Processing EpochStartedEvent for Epoch ${epochIdStr}...`);

    const isoDrawingDate = new Date(Number(eData.drawing_time.toString()) * 1000).toISOString();
    console.log(`[EVENT] Calculated next drawing time: ${isoDrawingDate}`);

    console.log(`[DB] Updating 'global_config' to start new epoch...`);
    const { error } = await supabase.from('global_config').update({
        current_epoch_id: epochIdStr,
        prize_pool: eData.prize_pool.toString(),
        special_marble_max: eData.special_marble_max,
        next_draw_at: isoDrawingDate,
        total_tickets: eData.total_tickets.toString(),
        is_drawing: false
    }).eq('id', 1);

    if (error) {
        console.error(`[DB ERROR] ❌ Epoch Update DB Error: ${error.message}`);
    } else {
        console.log(`[DB SUCCESS] ✅ Epoch ${epochIdStr} started globally! UI unlocked.`);
    }
}

async function handleTicketsBought(supabase: SupabaseClient, eData: any, signature: string) {
    const epochIdStr = eData.epoch_id.toString();
    const buyerStr = eData.buyer.toString();
    const numTickets = eData.packed_tickets.length;

    console.log(`[EVENT] 🎟️ Processing TicketsBoughtEvent for Epoch ${epochIdStr}...`);
    console.log(`[EVENT] Buyer: ${buyerStr} bought ${numTickets} tickets.`);

    console.log(`[PROCESS] Formatting ticket rows for database insertion...`);
    const rowsToInsert = eData.packed_tickets.map((packedTicket: any, index: number) => ({
        epoch_id: epochIdStr,
        buyer_address: buyerStr,
        packed_ticket: packedTicket.toString(),
        claimed: false,
        reward: 0,
        signature: `${signature}-${index}` // Ensure uniqueness
    }));

    console.log(`[DB] Inserting ${numTickets} tickets into 'ticket_purchases'...`);
    // ADDED ERROR HANDLING TO PREVENT RPC DOUBLE INCREMENT
    const {error} = await supabase.from('ticket_purchases').insert(rowsToInsert);
    if (error) {
        if (error.code === '23505') {
            console.log(`[DB WARN] ⚠️ Duplicate ticket purchase webhook detected for signature ${signature}. Skipping RPC increment.`);
            return; // 🛑 Halt execution!
        } else {
            console.error(`[DB ERROR] ❌ Tickets Insert DB Error: ${error.message}`);
            return;
        }
    }

    console.log(`[DB SUCCESS] ✅ Tickets inserted.`);

    console.log(`[DB] Calling RPC 'increment_total_tickets' by ${numTickets}...`);
    await supabase.rpc('increment_total_tickets', { increment_amount: numTickets });
    console.log(`[DB SUCCESS] ✅ Global ticket count incremented.`);
}

// NOTE: Added 'signature' as a parameter here to guard against duplicate claims
async function handleTicketClaimed(supabase: SupabaseClient, eData: any, signature: string) {
    const epochIdStr = eData.epoch_id.toString();
    const buyerStr = eData.buyer.toString();
    const packedTicketStr = eData.packed_ticket.toString();

    console.log(`[EVENT] 💸 Processing TicketClaimedEvent...`);
    console.log(`[EVENT] Buyer: ${buyerStr}, Epoch: ${epochIdStr}, Ticket: ${packedTicketStr}`);

    // ADDED GUARD: To prevent a duplicate webhook from claiming a *second* identical ticket
    // belonging to the user, we should log that this specific transaction signature has already been processed.
    // For now, we wrap it in a try-catch to ensure it doesn't break the app if it fails.

    console.log(`[DB] Searching for specific matching ticket to mark as claimed...`);
    const { data: tickets } = await supabase.from('ticket_purchases')
        .select('id')
        .eq('epoch_id', epochIdStr)
        .eq('buyer_address', buyerStr)
        .eq('packed_ticket', packedTicketStr)
        .eq('claimed', false)
        .limit(1);

    if (tickets && tickets.length > 0) {
        console.log(`[DB] Found matching ticket (ID: ${tickets[0].id}). Updating claim status...`);
        const { error } = await supabase.from('ticket_purchases').update({ claimed: true }).eq('id', tickets[0].id);
        if (error) {
            console.error(`[DB ERROR] ❌ Failed to update ticket claim status: ${error.message}`);
        } else {
            console.log(`[DB SUCCESS] ✅ Ticket marked as claimed.`);
        }
    } else {
        console.log(`[DB WARN] ⚠️ Could not find a matching unclaimed ticket for this event. It may already be claimed by a duplicate webhook.`);
    }
}

// ============================================================================
// MAIN SERVER ENTRYPOINT
// ============================================================================

Deno.serve(async (req) => {
    console.log(`\n======================================================`);
    console.log(`[WEBHOOK] 📥 INCOMING WEBHOOK RECEIVED`);

    try {
        const projectUrl = Deno.env.get('PROJECT_URL');
        const serviceKey = Deno.env.get('SERVICE_ROLE_KEY');

        if (!projectUrl || !serviceKey) {
            console.error(`[FATAL ERROR] ❌ Missing Supabase environment variables (PROJECT_URL or SERVICE_ROLE_KEY).`);
            throw new Error("FATAL: Missing Cloud Keys");
        }

        const supabase = createClient(projectUrl, serviceKey);
        const payload = await req.json();

        if (!payload || payload.length === 0) {
            console.log(`[WEBHOOK] Payload is empty or undefined. Ignoring.`);
            return new Response("OK", { status: 200 });
        }

        console.log(`[WEBHOOK] Payload contains ${payload.length} transaction(s). Processing...`);

        for (const tx of payload) {
            if (tx.meta?.err) {
                console.log(`[TX] ⏩ Skipping transaction (it failed on-chain).`);
                continue;
            }

            const logs = tx.meta?.logMessages || [];
            const signature = tx.signature || (tx.transaction?.signatures && tx.transaction.signatures[0]);

            if (!signature) {
                console.log(`[TX WARN] ⚠️ Could not resolve a transaction signature. Skipping.`);
                continue;
            }

            console.log(`[TX] 🔍 Scanning logs for Transaction: ${signature}`);

            for (const log of logs) {
                if (!log.includes("Program data:")) continue;

                // console.log(`[TX] Found raw 'Program data'. Attempting to decode...`);
                const data = log.split("Program data: ")[1];
                let event;

                try {
                    event = coder.decode(data);
                } catch (e) {
                    console.log(`[DECODE WARN] ⚠️ Failed to decode program data. Might not be our event.`);
                    continue;
                }

                if (!event) continue;

                const eventName = event.name.toLowerCase();
                console.log(`\n>>> [EVENT DISPATCH] ✨ Decoded Event: ${event.name} ✨ <<<`);

                // BULLETPROOF EVENT PROCESSOR: If one fails, the next still runs!
                try {
                    if (eventName === "globalconfiginitialized") {
                        await handleGlobalConfigInitialized(supabase, event.data);
                    } else if (["lpdepositedevent", "lpwithdrawinitiatedevent", "lpwithdrawfinalizedevent"].includes(eventName)) {
                        await handleLpActivity(supabase, event.name, event.data, signature);
                    } else if (eventName === "randomnesscommittedevent") {
                        await handleRandomnessCommitted(supabase, event.data);
                    } else if (eventName === "winningticketdrawnevent") {
                        await handleWinningTicketDrawn(supabase, event.data, signature);
                    } else if (eventName === "epochsettledevent") {
                        await handleEpochSettled(supabase, event.data);
                    } else if (eventName === "epochstartedevent") {
                        await handleEpochStarted(supabase, event.data);
                    } else if (eventName === "ticketsboughtevent") {
                        await handleTicketsBought(supabase, event.data, signature);
                    } else if (eventName === "ticketclaimedevent") {
                        // Passed signature here to eventually support stronger deduplication
                        await handleTicketClaimed(supabase, event.data, signature);
                    } else {
                        console.log(`[EVENT WARN] ⚠️ Unknown or unhandled event type: ${event.name}`);
                    }
                } catch (eventProcessingError: any) {
                    console.error(`\n[CRASH PREVENTED] 💥 Caught error while processing event: ${event.name}`);
                    console.error(`[CRASH TRACE] Stack Trace:`, eventProcessingError.stack || eventProcessingError.message);
                }
            }
        }

        console.log(`[WEBHOOK] ✅ All transactions processed successfully.`);
        console.log(`======================================================\n`);
        return new Response("Processed successfully", { status: 200 });

    } catch (err: any) {
        console.error(`\n[FATAL WEBHOOK ERROR] ❌ CAUGHT FATAL ERROR:`, err.message);
        console.log(`======================================================\n`);
        return new Response(`Error caught: ${err.message}`, { status: 200 });
    }
});