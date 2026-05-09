import { useEffect, useState, useRef, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { supabase } from '../lib/supabaseClient';
import { useNavigate } from 'react-router-dom';
import { useAppData } from '../context/AppDataContext';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import IDL from '../idl/lords_pot.json';
import {
    getGlobalStatePda,
    getDrawingStatePda,
    getTicketTrackerPda,
    getUserTicketsPda,
    getTierPayoutsPda,
    getUserMintATA,
    getProtocolUsdcVaultAta
} from '../../../tests/utils/seeds_and_ata';

const PAGE_SIZE = 5;

function getTicketStatus(ticket: any, ticketEpoch: number, currentEpoch: number) {
    if (Number(ticketEpoch) === Number(currentEpoch)) return 'pending';
    if (ticket.reward > 0 && !ticket.claimed) return 'winner';
    if (ticket.reward > 0 && ticket.claimed) return 'claimed';
    return 'loser';
}

function unpackTicketForUI(packedStr: string, normalMax: number) {
    try {
        const packed = BigInt(packedStr);
        const numbers: number[] = [];
        let bonus = 0;
        for (let i = 0; i <= normalMax; i++) if ((packed & (1n << BigInt(i))) !== 0n) numbers.push(i);
        for (let i = normalMax + 1; i <= 63; i++) {
            if ((packed & (1n << BigInt(i))) !== 0n) { bonus = i - normalMax; break; }
        }
        return { numbers, bonus };
    } catch (e) { return { numbers: [0, 0, 0, 0, 0], bonus: 0 }; }
}

export const MyTickets = () => {
    const { connected, publicKey, wallet } = useWallet();
    const { connection } = useConnection();

    // PULL GLOBALS FROM CONTEXT (Extracting Mint Address here to obey React Hook Rules!)
    const { current_epoch_id, normal_marble_max, lastEpochUpdate, devnet_mock_usdc_mint_address } = useAppData();

    const [epochGroups, setEpochGroups] = useState<any[]>([]);
    const [totalValue, setTotalValue] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(true);

    // NEW: Track which ticket is actively claiming to show a loading spinner/text
    const [claimingId, setClaimingId] = useState<string | null>(null);

    const navigate = useNavigate();
    const isFetching = useRef(false);
    const observer = useRef<IntersectionObserver | null>(null);

    const lastElementRef = useCallback((node: any) => {
        if (isLoading || !hasMore) return;
        if (observer.current) observer.current.disconnect();
        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && hasMore && !isFetching.current) setPage(prev => prev + 1);
        });
        if (node) observer.current.observe(node);
    }, [isLoading, hasMore]);

    const loadData = useCallback(async (pageNum: number) => {
        // BULLETPROOF SHIELD: Wait until normal_marble_max is actually loaded
        if (!publicKey || isFetching.current || normal_marble_max === 0) return;

        isFetching.current = true;
        setIsLoading(true);
        try {
            if (pageNum === 0) {
                const { data: totalData } = await supabase
                    .from('ticket_purchases')
                    .select('reward')
                    .eq('buyer_address', publicKey.toBase58())
                    .eq('claimed', false);

                if (totalData) {
                    setTotalValue(totalData.reduce((acc, row) => acc + (row.reward || 0), 0) / 1e6); // Format USDC
                }
            }
            const start = pageNum * PAGE_SIZE;
            const end = start + PAGE_SIZE - 1;
            const { data, error } = await supabase.from('user_ticket_history').select('*').eq('buyer_address', publicKey.toBase58()).order('epoch_id', { ascending: false }).range(start, end);
            if (error) throw error;
            if (data) {
                const processed = data.map((epochBlock: any) => ({
                    epochId: epochBlock.epoch_id,
                    tickets: epochBlock.tickets.map((t: any) => ({
                        ...t,
                        unpacked: unpackTicketForUI(t.packedTicket.toString(), normal_marble_max),
                        status: getTicketStatus(t, epochBlock.epoch_id, current_epoch_id)
                    }))
                }));
                setEpochGroups(prev => pageNum === 0 ? processed : [...prev, ...processed]);
                if (data.length < PAGE_SIZE) setHasMore(false);
            }
        } catch (err) { console.error(err); }
        finally { setIsLoading(false); isFetching.current = false; }
    }, [publicKey, normal_marble_max, current_epoch_id]);

    // INITIAL LOAD
    useEffect(() => {
        if (connected && publicKey && normal_marble_max > 0) {
            setPage(0);
            setEpochGroups([]);
            setHasMore(true);
            loadData(0);
        }
    }, [connected, publicKey, normal_marble_max, loadData]);

    useEffect(() => { if (page > 0) loadData(page); }, [page, loadData]);

    // THE MAGIC REFRESHER (Triggered by Context)
    useEffect(() => {
        if (connected && publicKey && normal_marble_max > 0) {
            console.log("Epoch Rolled Over - Refreshing Tickets!");
            setPage(0);
            setEpochGroups([]);
            setHasMore(true);
            loadData(0);
        }
    }, [lastEpochUpdate, connected, publicKey, normal_marble_max, loadData]);

    // ============================================================================
    // THE CLAIM HANDLER
    // ============================================================================
    const handleClaim = async (epochId: number, packedTicket: string, reward: number, groupIndex: number, ticketIndex: number) => {
        if (!wallet || !publicKey || !connected) return;

        // Lock UI for this specific ticket
        const claimKey = `${epochId}-${packedTicket}-${ticketIndex}`;
        setClaimingId(claimKey);

        try {
            const provider = new AnchorProvider(connection, wallet.adapter as any, AnchorProvider.defaultOptions());
            const program = new Program(IDL as any, provider);

            // 1. Fetch PDAs using your elegant Utility File!
            const globalStatePda = getGlobalStatePda()[0];
            const drawingStatePda = getDrawingStatePda(epochId)[0];
            const ticketTrackerPda = getTicketTrackerPda(epochId)[0];
            const userTicketsPda = getUserTicketsPda(publicKey, epochId)[0];
            const tierPayoutsPda = getTierPayoutsPda(epochId)[0];

            // 2. Token Accounts
            const usdcMint = new PublicKey(devnet_mock_usdc_mint_address);
            const userUsdcAccount = getUserMintATA(publicKey, usdcMint);
            const protocolUsdcVault = getProtocolUsdcVaultAta();

            // 3. Execute Transaction
            console.log(`Initiating Claim for Ticket: ${packedTicket} in Epoch: ${epochId}`);

            const tx = await program.methods
                .claimRewards(new BN(epochId), new BN(packedTicket))
                .accounts({
                    signer: publicKey,
                    globalStateAccount: globalStatePda,
                    drawingStateAccount: drawingStatePda,
                    ticketTracker: ticketTrackerPda,
                    userTickets: userTicketsPda,
                    usdcMint: usdcMint,
                    userUsdcAccount: userUsdcAccount,
                    protocolUsdcVault: protocolUsdcVault,
                    tierPayouts: tierPayoutsPda,
                    tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
                    systemProgram: new PublicKey("11111111111111111111111111111111"),
                } as any)
                .rpc();

            console.log("✅ Claim successful! Tx:", tx);

            // 4. --- OPTIMISTIC UI UPDATE ---
            // Deduct from Total Rewards (preventing negatives)
            setTotalValue(prev => Math.max(0, prev - (reward / 1e6)));

            // Visually turn the button into "CLAIMED"
            setEpochGroups(prevGroups => {
                const newGroups = [...prevGroups];
                newGroups[groupIndex].tickets[ticketIndex] = {
                    ...newGroups[groupIndex].tickets[ticketIndex],
                    claimed: true,
                    status: 'claimed'
                };
                return newGroups;
            });

        } catch (error) {
            console.error("❌ Claim failed:", error);
        } finally {
            setClaimingId(null);
        }
    };

    if (!connected) {
        return (
            <div className="min-h-[calc(100vh-64px)] md:min-h-[calc(100vh-80px)] flex flex-col gap-3 items-center justify-center bg-[#0a0a0a] p-4 text-center">
                <span className="text-4xl md:text-5xl drop-shadow-[0_0_15px_rgba(212,175,55,0.4)] animate-pulse">🤴</span>
                <p className="text-[10px] md:text-[11px] text-[#D4AF37]/50 tracking-[0.15em] uppercase font-black">
                    Connect wallet to Peek
                </p>
            </div>
        );
    }

    return (
        <div className="relative min-h-screen pb-10 md:pb-12 text-white bg-[#0a0a0a]">
            <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(212,175,55,0.06)_0%,transparent_60%)] pointer-events-none" />
            <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(212,175,55,0.03)_0%,transparent_60%)] pointer-events-none" />

            <div className="sticky top-[64px] md:top-20 z-40 pt-3 md:pt-4 pb-2 md:pb-3 px-4 sm:px-6 bg-[#0a0a0a]/90 backdrop-blur-xl border-b border-[#D4AF37]/10 shadow-[0_5px_15px_rgba(0,0,0,0.8)]">
                <div className="max-w-4xl mx-auto flex flex-row items-center justify-between gap-2">
                    <h2 className="text-base md:text-xl font-black uppercase tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-[#a3a3a3]">
                        MY TICKETS
                    </h2>
                    <div className="text-right">
                        <p className="text-[8px] md:text-[9px] font-black text-[#D4AF37]/80 tracking-[0.15em] uppercase mb-0">Total Rewards</p>
                        <p className="text-lg md:text-xl font-black text-[#D4AF37] drop-shadow-md leading-tight">${totalValue.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                    </div>
                </div>
            </div>

            <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 mt-4 md:mt-6">
                {isLoading && epochGroups.length === 0 ? (
                    <div className="space-y-6 md:space-y-8 animate-pulse">
                        {[1, 2].map(i => (
                            <div key={i}>
                                <div className="h-5 md:h-6 w-20 md:w-24 bg-[#D4AF37]/10 rounded-full mb-3 md:mb-4 border border-[#D4AF37]/20"></div>
                                <div className="space-y-2 ml-0 md:ml-4">
                                    <div className="h-14 md:h-16 w-full bg-white/[0.02] border border-white/5 rounded-xl md:rounded-2xl"></div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : epochGroups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 md:py-12 px-4 text-center border border-[#D4AF37]/20 rounded-[1rem] md:rounded-[1.5rem] bg-black/40 backdrop-blur-xl shadow-[0_4px_20px_rgba(0,0,0,0.5)] max-w-lg mx-auto">
                        <div className="w-12 h-12 md:w-14 md:h-14 bg-gradient-to-br from-[#FFD700]/10 to-[#B8860B]/5 rounded-full flex items-center justify-center mb-3 md:mb-4 border border-[#D4AF37]/30 shadow-[0_0_20px_rgba(212,175,55,0.15)]">
                            <span className="text-2xl md:text-3xl drop-shadow-[0_0_10px_rgba(212,175,55,0.4)]">🤴</span>
                        </div>
                        <h3 className="text-lg md:text-xl font-black mb-1.5 md:mb-2 uppercase tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-[#a3a3a3]">The Vault is Empty</h3>
                        <p className="text-[9px] md:text-[10px] text-[#D4AF37]/80 max-w-[240px] md:max-w-[280px] font-medium leading-relaxed mb-4 md:mb-6 italic">"Go on… don’t be shy—become the Lord’s humble servant. Blessings, & suspiciously lucky wins included."</p>
                        <button onClick={() => navigate('/buy-tickets')} className="relative w-full max-w-[10rem] md:max-w-[12rem] py-2.5 md:py-3 overflow-hidden group rounded-lg md:rounded-xl transition-all active:scale-95">
                            <div className="absolute inset-0 bg-gradient-to-r from-[#B8860B] via-[#FFD700] to-[#B8860B] bg-[length:200%_100%] animate-[gradient_2s_linear_infinite]" />
                            <div className="absolute inset-[2px] bg-[#111] rounded-[6px] md:rounded-[10px] group-hover:bg-transparent transition-colors duration-300 z-0" />
                            <span className="relative z-10 text-[9px] md:text-[10px] font-black tracking-[0.1em] text-[#D4AF37] group-hover:text-black transition-colors duration-300">GET FIRST TICKET</span>
                        </button>
                    </div>
                ) : (
                    <div className="space-y-6 md:space-y-8">
                        {epochGroups.map((group, groupIndex) => (
                            <div key={group.epochId} ref={groupIndex === epochGroups.length - 1 ? lastElementRef : null}>
                                <div className="flex items-center gap-2 md:gap-3 mb-3 md:mb-4 w-full">
                                    <div className="bg-[#D4AF37]/10 px-3 py-1 md:py-1.5 rounded-full border border-[#D4AF37]/30 backdrop-blur-md shadow-[0_0_5px_rgba(212,175,55,0.1)] flex-shrink-0">
                                        <h3 className="text-[8px] md:text-[9px] font-black tracking-[0.2em] text-[#D4AF37] uppercase">Epoch {group.epochId}</h3>
                                    </div>
                                    <div className="h-[1px] flex-grow bg-gradient-to-r from-[#D4AF37]/30 via-[#D4AF37]/10 to-transparent self-center" />
                                </div>

                                <div className="space-y-2 md:space-y-2.5 ml-0 md:ml-4">
                                    {group.tickets.map((ticket: any, ticketIndex: number) => {
                                        const isInactive = ticket.status === 'loser' || ticket.status === 'claimed';
                                        const isClaiming = claimingId === `${group.epochId}-${ticket.packedTicket}-${ticketIndex}`;

                                        return (
                                            <div key={ticketIndex} className={`bg-black/40 backdrop-blur-xl border rounded-xl md:rounded-2xl p-2 md:p-3 flex flex-col lg:flex-row items-center justify-between gap-2 md:gap-4 transition-all duration-300 ease-out hover:scale-[1.01] ${ticket.status === 'winner' ? 'border-[#D4AF37]/40 shadow-[0_0_10px_rgba(212,175,55,0.1)]' : 'border-white/5 shadow-sm'} ${isInactive ? 'opacity-60 grayscale-[0.3]' : 'hover:bg-[#111]'}`}>
                                                <div className="flex gap-1 md:gap-1.5 flex-wrap justify-center">
                                                    {ticket.unpacked.numbers.map((n: any, idx: any) => (
                                                        <div key={idx} className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 rounded-full bg-[#0d0d0d] flex items-center justify-center text-[9px] md:text-[11px] font-black border border-white/10 text-slate-300 shadow-inner">
                                                            {n}
                                                        </div>
                                                    ))}
                                                    <div className={`w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center text-[9px] md:text-[11px] font-black transition-all duration-500 ${isInactive ? 'bg-black border border-white/10 text-[#D4AF37]/40' : 'bg-gradient-to-br from-[#FFD700] to-[#B8860B] text-black shadow-[0_0_8px_rgba(212,175,55,0.3)] ring-1 ring-[#FFD700]/30'}`}>
                                                        {ticket.unpacked.bonus}
                                                    </div>
                                                </div>

                                                <div className="w-full lg:w-28 h-8 md:h-9 flex-shrink-0 flex items-center justify-center">
                                                    {ticket.status === 'winner' && (
                                                        <button
                                                            onClick={() => handleClaim(group.epochId, ticket.packedTicket, ticket.reward, groupIndex, ticketIndex)}
                                                            disabled={isClaiming}
                                                            className={`relative w-full h-full flex items-center justify-center overflow-hidden group rounded-lg transition-all p-0 ${isClaiming ? 'opacity-50 cursor-not-allowed' : 'active:scale-95'}`}
                                                        >
                                                            <div className="absolute inset-0 bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-500 bg-[length:200%_100%] animate-[gradient_2s_linear_infinite]" />
                                                            <div className="absolute inset-[1.5px] bg-[#111] rounded-[6px] group-hover:bg-transparent transition-colors duration-300 z-0" />
                                                            <span className="relative z-10 text-[8px] md:text-[9px] font-black tracking-[0.1em] md:tracking-[0.15em] text-emerald-400 group-hover:text-black transition-colors duration-300 leading-none">
                                                                {isClaiming
                                                                    ? 'CLAIMING...'
                                                                    : `CLAIM $${(ticket.reward / 1e6).toLocaleString()}`}
                                                            </span>
                                                        </button>
                                                    )}
                                                    {ticket.status === 'pending' && (
                                                        <div className="w-full h-full bg-[#111] border border-[#D4AF37]/20 rounded-lg flex items-center justify-center text-[7px] md:text-[8px] font-black text-[#D4AF37]/70 uppercase tracking-[0.1em] leading-none p-0">AWAITING DRAW</div>
                                                    )}
                                                    {ticket.status === 'claimed' && (
                                                        <div className="w-full h-full bg-emerald-900/10 border border-emerald-500/20 rounded-lg flex items-center justify-center text-[7px] md:text-[8px] font-black text-emerald-500/60 uppercase tracking-[0.1em] leading-none p-0">CLAIMED</div>
                                                    )}
                                                    {ticket.status === 'loser' && (
                                                        <div className="w-full h-full bg-black/50 border border-white/5 rounded-lg flex items-center justify-center text-[7px] md:text-[8px] font-black text-zinc-500 uppercase tracking-[0.1em] leading-none p-0">NO WIN</div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {isLoading && epochGroups.length > 0 && (
                    <div className="mt-6 md:mt-8 space-y-3 md:space-y-4 animate-pulse ml-0 md:ml-4">
                        <div className="h-14 md:h-16 w-full bg-white/[0.02] border border-white/5 rounded-xl md:rounded-2xl"></div>
                    </div>
                )}
            </div>
        </div>
    );
};