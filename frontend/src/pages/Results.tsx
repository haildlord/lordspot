import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAppData } from '../context/AppDataContext';

// PERFECT GRADER: Matches frontend grading with Smart Contract grading
function gradeTicket(ticketPackedStr: string, winningPackedStr: string, normalMax: number) {
    if (!winningPackedStr) return 0;
    try {
        const ticket = BigInt(ticketPackedStr);
        const winning = BigInt(winningPackedStr);
        const normalMask = (1n << BigInt(normalMax + 1)) - 1n;
        let normalOverlap = (ticket & winning) & normalMask;
        let normalMatches = 0;
        while (normalOverlap > 0n) {
            if ((normalOverlap & 1n) === 1n) normalMatches++;
            normalOverlap >>= 1n;
        }
        const bonusMatch = ((ticket & winning) & ~normalMask) !== 0n;
        return (normalMatches * 2) + (bonusMatch ? 1 : 0);
    } catch { return 0; }
}

export const Results = () => {
    const { lastEpochUpdate, normal_marble_max } = useAppData();

    const [pastDraws, setPastDraws] = useState<any[]>([]);
    const [selectedEpoch, setSelectedEpoch] = useState<any | null>(null);
    const [activeTab, setActiveTab] = useState<'winners' | 'tiers'>('winners');
    const [prizeTiers, setPrizeTiers] = useState<any[]>([]);
    const [winnersList, setWinnersList] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [realTotalWinners, setRealTotalWinners] = useState(0);

    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

    const fetchEpochs = useCallback(async () => {
        setIsLoading(true);
        const { data, error } = await supabase
            .from('epochs')
            .select('*')
            .not('total_winners', 'is', null) // Only fully settled epochs
            .order('epoch_id', { ascending: false });

        if (data && !error) {
            const formatted = data.map(ep => {
                const pool = ep.prize_pool / 1e6;
                // Mathematically accurate Jackpot Display (40% of pool based on new weights)
                let jp = ep.jackpot / 1e6;
                if (jp === 0 && pool > 0) jp = pool * 0.40;

                return {
                    id: ep.epoch_id,
                    date: new Date(ep.drawn_at || ep.created_at || Date.now()).toLocaleDateString(),
                    normals: ep.winning_normals,
                    bonus: ep.winning_bonus,
                    packedWinningTicket: ep.packed_winning_ticket, // Needed to grade tickets dynamically
                    jackpot: jp,
                    prizePool: pool,
                    prizesPaid: ep.prizes_paid / 1e6,
                    houseEarned: ep.house_earned ? (ep.house_earned / 1e6) : 0 // Pull directly from DB, no fake math!
                };
            });
            setPastDraws(formatted);
        }
        setIsLoading(false);
    }, []);

    useEffect(() => {
        fetchEpochs();
    }, [lastEpochUpdate, fetchEpochs]);

    useEffect(() => {
        if (!selectedEpoch) return;

        const getTierInfo = (tierIndex: number, prizePool: number, actualPrize: number, realWinnerCount: number) => {
            // PERFECT SYNC: Matches Rust PREMIUM_TIER_WEIGHTS exactly
            const tierMapping = [
                { text: "No Match", normals: 0, bonus: 0, alloc: 0 },
                { text: "1 Lord", normals: 0, bonus: 1, alloc: 0 },
                { text: "1 number", normals: 1, bonus: 0, alloc: 0 },
                { text: "1 number + 1 Lord", normals: 1, bonus: 1, alloc: 0.12 }, // Rust pays 12%
                { text: "2 numbers", normals: 2, bonus: 0, alloc: 0 }, // Rust pays 0%
                { text: "2 numbers + 1 Lord", normals: 2, bonus: 1, alloc: 0.12 },
                { text: "3 numbers", normals: 3, bonus: 0, alloc: 0.12 },
                { text: "3 numbers + 1 Lord", normals: 3, bonus: 1, alloc: 0.06 },
                { text: "4 numbers", normals: 4, bonus: 0, alloc: 0.06 },
                { text: "4 numbers + 1 Lord", normals: 4, bonus: 1, alloc: 0.06 },
                { text: "5 numbers", normals: 5, bonus: 0, alloc: 0.06 },
                { text: "5 numbers + 1 Lord (Jackpot)", normals: 5, bonus: 1, alloc: 0.40 } // Rust pays 40%
            ];

            const mapping = tierMapping[tierIndex];
            let prizeDisplay = "$0.00";
            let isValidWinner = false; // Tracks if this tier actually pays money

            if (actualPrize > 0) {
                // If the epoch is settled and paid cash, show it
                prizeDisplay = `$${actualPrize.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
                isValidWinner = true;
            } else if (mapping.alloc > 0) {
                // If the epoch is pending, project the prize
                const projected = prizePool * mapping.alloc;
                prizeDisplay = `$${projected.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
                isValidWinner = true;
            }
            // If actualPrize is 0 AND alloc is 0, it falls through to "$0.00" and isValidWinner remains false

            return {
                normals: mapping.normals,
                bonus: mapping.bonus,
                text: mapping.text,
                prize: prizeDisplay,
                // THE FIX: If the tier pays $0, force the winner count to 0 so the UI says "No winning tickets"
                winners: isValidWinner ? realWinnerCount : 0
            };
        };

        const fetchDetails = async () => {
            // 1. Fetch Tiers (for actual payouts)
            const { data: tiersData } = await supabase
                .from('epoch_prize_tiers')
                .select('*')
                .eq('epoch_id', selectedEpoch.id);

            // 2. Fetch ALL Tickets for this epoch to find the REAL winners
            const { data: allTickets } = await supabase
                .from('ticket_purchases')
                .select('buyer_address, reward, packed_ticket')
                .eq('epoch_id', selectedEpoch.id);

            const realTierCounts = new Array(12).fill(0);
            let calculatedTotalWinners = 0;
            const groupedWinnersMap = new Map();

            if (allTickets) {
                for (const t of allTickets) {
                    const tier = gradeTicket(t.packed_ticket, selectedEpoch.packedWinningTicket, normal_marble_max || 22);

                    realTierCounts[tier]++; // Always count it for the Tiers tab stats

                    // THE FIX: A ticket is ONLY a winner if the smart contract actually assigned it USDC
                    const isWinner = Number(t.reward) > 0;

                    if (isWinner) {
                        calculatedTotalWinners++;

                        // Build the Winners List (Cash only)
                        const existing = groupedWinnersMap.get(t.buyer_address);
                        if (existing) {
                            groupedWinnersMap.set(t.buyer_address, {
                                address: t.buyer_address,
                                tickets: existing.tickets + 1,
                                amount: existing.amount + Number(t.reward)
                            });
                        } else {
                            groupedWinnersMap.set(t.buyer_address, {
                                address: t.buyer_address,
                                tickets: 1,
                                amount: Number(t.reward)
                            });
                        }
                    }
                }
            }

            setRealTotalWinners(calculatedTotalWinners);

            // 3. Format Tiers with REAL counts
            const formattedTiers = [];
            for (let i = 11; i >= 0; i--) {
                const dbTier = tiersData?.find((t: any) => t.tier_index === i);
                const actualPrize = dbTier ? (dbTier.prize_per_ticket / 1e6) : 0;

                const info = getTierInfo(i, selectedEpoch.prizePool, actualPrize, realTierCounts[i]);
                formattedTiers.push(info);
            }
            setPrizeTiers(formattedTiers);

            // 4. Format Winners List
            const sortedWinners = Array.from(groupedWinnersMap.values())
                .sort((a, b) => b.amount - a.amount) // Sort highest earners first
                .map(w => ({
                    address: `${w.address.slice(0,4)}...${w.address.slice(-4)}`,
                    fullAddress: w.address,
                    tickets: w.tickets,
                    amount: w.amount / 1e6
                }));
            setWinnersList(sortedWinners);
        };

        fetchDetails();
    }, [selectedEpoch, normal_marble_max]);

    const handleCopy = (address: string, index: number) => {
        navigator.clipboard.writeText(address);
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
    };

    const WinningBallsDisplay = ({ normals, bonus, size = 'md' }: { normals: number[], bonus: number, size?: 'sm' | 'md' }) => {
        const ballClass = size === 'md' ? 'w-7 h-7 md:w-9 md:h-9 text-[10px] md:text-xs' : 'w-5 h-5 md:w-6 md:h-6 text-[8px] md:text-[10px]';
        return (
            <div className="flex items-center justify-center gap-1.5 md:gap-2 mb-4 md:mb-6">
                <div className="flex bg-[#111] border border-white/10 rounded-full p-1 gap-1 shadow-inner">
                    {normals.map((num, i) => (
                        <div key={i} className={`${ballClass} rounded-full bg-white text-black flex items-center justify-center font-black shadow-sm`}>{num}</div>
                    ))}
                </div>
                <div className={`${ballClass} rounded-full bg-gradient-to-br from-[#FFD700] to-[#B8860B] text-black flex items-center justify-center font-black shadow-[0_0_10px_rgba(212,175,55,0.4)] ring-2 ring-[#FFD700]/30`}>
                    {bonus}
                </div>
            </div>
        );
    };

    // LIST VIEW
    if (!selectedEpoch) {
        return (
            <div className="relative min-h-[calc(100vh-64px)] md:min-h-[calc(100vh-80px)] pt-6 pb-16 px-4 sm:px-6 overflow-hidden bg-[#0a0a0a] text-white">
                <div className="absolute top-0 inset-x-0 h-full bg-[radial-gradient(ellipse_at_top,rgba(212,175,55,0.06)_0%,transparent_65%)] pointer-events-none z-0" />

                <div className="relative z-10 w-full max-w-[500px] md:max-w-2xl mx-auto flex flex-col">
                    <h2 className="text-xl md:text-2xl font-black uppercase tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-[#a3a3a3] mb-6 px-2 text-center md:text-left">
                        Past Draws
                    </h2>

                    {isLoading ? (
                        <div className="text-center text-slate-500 py-10 animate-pulse font-bold tracking-widest uppercase">Fetching Blockchain Logs...</div>
                    ) : pastDraws.length === 0 ? (
                        <div className="text-center text-slate-500 py-10 font-bold tracking-widest uppercase border border-white/5 rounded-2xl bg-[#111]">No completed epochs yet</div>
                    ) : (
                        <div className="flex flex-col gap-6 md:gap-8">
                            {pastDraws.map((draw) => (
                                <div key={draw.id} className="flex flex-col">
                                    <span className="text-[11px] md:text-sm font-bold text-slate-400 mb-2 px-2 tracking-wide">
                                        {draw.date} <span className="text-[#D4AF37]/50 ml-2">Epoch {draw.id}</span>
                                    </span>

                                    <div className="w-full bg-[#111] backdrop-blur-xl border border-white/5 hover:border-[#D4AF37]/30 transition-colors shadow-[0_4px_30px_rgba(0,0,0,0.3)] rounded-[1.25rem] md:rounded-[1.5rem] p-5 md:p-6 relative overflow-hidden group">
                                        <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/10 via-purple-900/5 to-[#D4AF37]/5 opacity-50 pointer-events-none" />

                                        <div className="relative z-10">
                                            <WinningBallsDisplay normals={draw.normals} bonus={draw.bonus} />

                                            <div className="flex justify-between items-center mb-5 md:mb-6 border-t border-white/5 pt-4">
                                                <div className="text-center flex-1 border-r border-white/5">
                                                    <p className="text-[9px] md:text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">Jackpot</p>
                                                    <p className="text-lg md:text-xl font-black text-white">${draw.jackpot.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                                                </div>
                                                <div className="text-center flex-1">
                                                    <p className="text-[9px] md:text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">Prize Pool</p>
                                                    <p className="text-lg md:text-xl font-black text-[#D4AF37]">${draw.prizePool.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                                                </div>
                                            </div>

                                            <button
                                                onClick={() => setSelectedEpoch(draw)}
                                                className="w-full py-3 bg-white/5 hover:bg-white/10 text-white text-[10px] md:text-xs font-black tracking-[0.2em] rounded-xl transition-all uppercase flex items-center justify-center gap-2 group-hover:bg-[#D4AF37]/10 group-hover:text-[#D4AF37] group-hover:border-[#D4AF37]/30 border border-transparent"
                                            >
                                                Round details
                                                <svg className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // DETAIL VIEW
    return (
        <div className="relative min-h-[calc(100vh-64px)] md:min-h-[calc(100vh-80px)] pt-4 md:pt-6 pb-12 md:pb-16 px-4 sm:px-6 overflow-hidden bg-[#0a0a0a] text-white animate-fade-in">
            <div className="absolute top-0 inset-x-0 h-full bg-[radial-gradient(ellipse_at_top,rgba(212,175,55,0.06)_0%,transparent_65%)] pointer-events-none z-0" />

            <div className="relative z-10 w-full max-w-[500px] md:max-w-2xl mx-auto flex flex-col">
                <div className="flex items-center gap-4 mb-6 md:mb-8 px-1">
                    <button
                        onClick={() => setSelectedEpoch(null)}
                        className="w-8 h-8 md:w-10 md:h-10 bg-[#111] hover:bg-[#1a1a1a] border border-white/10 rounded-full flex items-center justify-center transition-colors text-slate-400 hover:text-white"
                    >
                        <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                    </button>
                    <h2 className="text-xl md:text-2xl font-black uppercase tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-[#a3a3a3]">
                        {selectedEpoch.date.toUpperCase()} <span className="text-[#D4AF37]/50 text-base md:text-lg ml-2">EPOCH {selectedEpoch.id}</span>
                    </h2>
                </div>

                <div className="w-full bg-[#111] backdrop-blur-xl border border-[#D4AF37]/20 shadow-[0_4px_30px_rgba(0,0,0,0.5)] rounded-[1.25rem] md:rounded-[1.5rem] p-5 md:p-6 mb-6 relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-[#D4AF37]/10 via-purple-900/10 to-transparent pointer-events-none" />

                    <div className="relative z-10">
                        <WinningBallsDisplay normals={selectedEpoch.normals} bonus={selectedEpoch.bonus} />

                        <div className="flex justify-between items-center border-t border-white/5 pt-4">
                            <div className="text-center flex-1 border-r border-white/5">
                                <p className="text-[9px] md:text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">Jackpot</p>
                                <p className="text-lg md:text-2xl font-black text-white">${selectedEpoch.jackpot.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                            </div>
                            <div className="text-center flex-1 flex flex-col items-center justify-center">
                                <p className="text-[9px] md:text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">Prize Winners</p>
                                <div className="flex items-center gap-2">
                                    <p className="text-lg md:text-2xl font-black text-[#D4AF37]">{realTotalWinners.toLocaleString()}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex justify-between items-end mb-4 px-1">
                    <h3 className="text-sm md:text-base font-black text-white">Round Stats</h3>
                </div>

                <div className="flex bg-[#111] border border-white/5 rounded-xl md:rounded-2xl p-4 mb-6 shadow-inner">
                    <div className="flex-1 text-center border-r border-white/5">
                        <p className="text-[9px] md:text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">Prizes paid</p>
                        <p className="text-base md:text-lg font-black text-white">${selectedEpoch.prizesPaid.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                    </div>
                    <div className="flex-1 text-center">
                        <p className="text-[9px] md:text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">House Edge Earned</p>
                        <p className="text-base md:text-lg font-black text-[#D4AF37]">${selectedEpoch.houseEarned.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                    </div>
                </div>

                <div className="flex gap-4 md:gap-6 border-b border-white/10 mb-4 md:mb-6 px-1">
                    <button onClick={() => setActiveTab('winners')} className={`pb-2 md:pb-3 text-[11px] md:text-xs font-black tracking-[0.15em] uppercase transition-colors relative ${activeTab === 'winners' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                        Winners
                        {activeTab === 'winners' && <div className="absolute bottom-0 left-0 w-full h-[2px] bg-[#D4AF37] rounded-t-full shadow-[0_0_8px_rgba(212,175,55,0.8)]" />}
                    </button>
                    <button onClick={() => setActiveTab('tiers')} className={`pb-2 md:pb-3 text-[11px] md:text-xs font-black tracking-[0.15em] uppercase transition-colors relative ${activeTab === 'tiers' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                        Prize Tiers
                        {activeTab === 'tiers' && <div className="absolute bottom-0 left-0 w-full h-[2px] bg-[#D4AF37] rounded-t-full shadow-[0_0_8px_rgba(212,175,55,0.8)]" />}
                    </button>
                </div>

                {activeTab === 'winners' && (
                    <div className="flex flex-col gap-2 animate-fade-in">
                        {winnersList.length === 0 ? (
                            <div className="text-center text-slate-500 py-10 font-bold uppercase tracking-widest bg-[#111] rounded-xl border border-white/5">No winning tickets this round</div>
                        ) : winnersList.map((winner, idx) => (
                            <div key={idx} className="flex items-center justify-between bg-[#111] hover:bg-[#1a1a1a] border border-white/5 rounded-xl p-3 md:p-4 transition-colors">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-gradient-to-br from-[#1a1a1a] to-[#222] flex items-center justify-center border border-white/10 shrink-0 shadow-inner">
                                        <span className="text-base md:text-lg">👤</span>
                                    </div>
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-1.5 mb-0.5">
                                            <span className="text-xs md:text-sm font-bold text-white tracking-wide font-mono">{winner.address}</span>
                                            <button onClick={() => handleCopy(winner.fullAddress, idx)} className="text-slate-500 hover:text-[#D4AF37] transition-colors p-1 rounded-md hover:bg-white/5" title="Copy Address">
                                                {copiedIndex === idx ? (
                                                    <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                                ) : (
                                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                                )}
                                            </button>
                                        </div>
                                        <span className="text-[9px] md:text-[10px] text-slate-400">{winner.tickets} winning tickets</span>
                                    </div>
                                </div>
                                <div className="bg-[#D4AF37]/10 border border-[#D4AF37]/30 px-2.5 py-1 rounded-md">
                                    <span className="text-xs md:text-sm font-black text-[#D4AF37] tracking-wide">
                                        {winner.amount > 0 ? `$${winner.amount.toFixed(2)}` : '$0.00(s)'}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {activeTab === 'tiers' && (
                    <div className="flex flex-col animate-fade-in">
                        <div className="bg-[#111] border border-[#D4AF37]/20 rounded-xl p-4 md:p-5 mb-6 shadow-inner flex justify-between items-center relative overflow-hidden">
                            <div className="absolute -right-10 -top-10 w-40 h-40 bg-[#D4AF37]/5 rounded-full blur-3xl pointer-events-none" />
                            <div className="relative z-10 max-w-[70%]">
                                <h4 className="text-xs md:text-sm font-black text-white mb-1 tracking-wide">How it works</h4>
                                <p className="text-[9px] md:text-[10px] text-slate-400 leading-relaxed">
                                    5 numbers + 1 bonus ball are drawn dynamically. The crowdfunded prize pool pays every tier securely on-chain.
                                </p>
                            </div>
                        </div>

                        <h3 className="text-sm md:text-base font-black text-white mb-3 px-1">Prize Tiers</h3>
                        <div className="flex flex-col divide-y divide-white/5 bg-[#111] border border-white/5 rounded-xl md:rounded-2xl overflow-hidden">
                            {prizeTiers.map((tier, idx) => (
                                <div key={idx} className="flex justify-between items-center p-3 md:p-4 hover:bg-white/[0.02] transition-colors">
                                    <div className="flex flex-col gap-1.5">
                                        <div className="flex items-center gap-[2px]">
                                            {Array.from({ length: tier.normals }).map((_, i) => (
                                                <div key={`n-${i}`} className="w-3.5 h-3.5 rounded-full bg-[#1a1a1a] border border-white/10 text-slate-400 text-[7px] flex items-center justify-center font-bold">N</div>
                                            ))}
                                            {tier.bonus === 1 && (
                                                <div className="w-3.5 h-3.5 rounded-full bg-[#D4AF37] shadow-[0_0_4px_rgba(212,175,55,0.4)] text-black text-[7px] flex items-center justify-center font-black ml-1">L</div>
                                            )}
                                        </div>
                                        <span className="text-[9px] md:text-[10px] text-slate-400 font-medium">{tier.text}</span>
                                    </div>
                                    <div className="text-right flex flex-col items-end gap-0.5">
                                        <span className="text-xs md:text-sm font-black text-white tracking-wide">{tier.prize}</span>
                                        <span className={`text-[8px] md:text-[9px] font-bold tracking-wide ${tier.winners > 0 ? 'text-[#D4AF37]' : 'text-slate-500'}`}>
                                            {tier.winners > 0 ? `${tier.winners.toLocaleString()} winning ticket${tier.winners > 1 ? 's' : ''}` : 'No winning tickets'}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};