import { useState, useEffect, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { PulsuatingCountDown } from "../components/PulsuatingCountDown";
import { useAppData } from "../context/AppDataContext";
import { useUserBalance, BalanceDisplay } from '../components/UsersLusdcBalanceFetcher';
import { Buffer } from 'buffer';

import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import IDL from '../idl/lords_pot.json';
import {
    getGlobalStatePda,
    getDrawingStatePda,
    getTicketTrackerPda,
    getUserTicketsPda,
    getProtocolUsdcVaultAta
} from "../../../tests/utils/seeds_and_ata.ts";
import {OnGoingEpoch} from "../components/OnGoingEpoch.tsx";

const generateTicket = (normalMax: number, specialMax: number) => {
    const normals = new Set<number>();
    while (normals.size < 5) normals.add(Math.floor(Math.random() * normalMax) + 1);
    return { normals: Array.from(normals).sort((a, b) => a - b), bonus: Math.floor(Math.random() * specialMax) + 1 };
};

export const BuyTickets = () => {
    const { connected, publicKey, wallet } = useWallet();
    const { connection } = useConnection();

    // 1. ALL REALTIME DATA COMES FROM CONTEXT!
    const {
        current_epoch_id,
        total_tickets,
        normal_marble_max,
        special_marble_max,
        userTicketCount,
        ticket_price,
        devnet_protocol_programid,
        devnet_mock_usdc_mint_address,
        isDrawing,
        lastEpochUpdate
    } = useAppData();

    const { balance } = useUserBalance();

    const [liveTotalTickets, setLiveTotalTickets] = useState(total_tickets);
    const [liveUserTickets, setLiveUserTickets] = useState(userTicketCount);

    // Keep state synced with the context which updates via Supabase automatically
    useEffect(() => { setLiveTotalTickets(total_tickets); }, [total_tickets]);
    useEffect(() => { setLiveUserTickets(userTicketCount); }, [userTicketCount]);

    // Safety Clear: If the epoch rolls over, dump any staged tickets so they don't buy for the wrong epoch
    useEffect(() => {
        setStagedTickets([]);
    }, [lastEpochUpdate]);

    const [isHowToPlayOpen, setIsHowToPlayOpen] = useState(false);
    const [isPrizeTiersOpen, setIsPrizeTiersOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'quick' | 'manual'>('quick');

    const GLOBAL_MAX = 600;
    const USER_MAX = 50;
    const ONGOING_EPOCH = current_epoch_id || 0;

    const [stagedTickets, setStagedTickets] = useState<{ normals: number[], bonus: number }[]>([]);
    const [genCount, setGenCount] = useState<number | ''>(1);
    const [txState, setTxState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

    const [manualNormals, setManualNormals] = useState<number[]>([]);
    const [manualBonus, setManualBonus] = useState<number | null>(null);

    const userRemaining = USER_MAX - liveUserTickets;
    const globalRemaining = GLOBAL_MAX - liveTotalTickets;

    const isGlobalFull = globalRemaining <= 0;
    const isUserFull = userRemaining <= 0;

    const absoluteMaxAllowed =  Math.min(userRemaining, globalRemaining);
    const maxCanStage = Math.max(0, absoluteMaxAllowed - stagedTickets.length);

    useEffect(() => {
        if (typeof genCount === 'number' && genCount > maxCanStage && maxCanStage > 0) setGenCount(maxCanStage);
        else if (maxCanStage === 0) setGenCount(0);
    }, [maxCanStage, genCount]);

    const handleGenCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        if (val === '') { setGenCount(''); return; }
        const num = parseInt(val, 10);
        if (isNaN(num)) return;
        if (num > maxCanStage) setGenCount(maxCanStage);
        else setGenCount(num);
    };

    const handleGenCountBlur = () => {
        if (genCount === '' || genCount < 1) setGenCount(maxCanStage > 0 ? 1 : 0);
    };

    const handleGenerateRandom = () => {
        const count = Number(genCount);
        if (count <= 0 || count > maxCanStage) return;
        const newTickets = Array.from({ length: count }, () => generateTicket(normal_marble_max, special_marble_max));
        setStagedTickets(prev => [...prev, ...newTickets]);
        setGenCount(1);
    };

    const toggleManualNormal = (num: number) => {
        if (manualNormals.includes(num)) setManualNormals(prev => prev.filter(n => n !== num));
        else if (manualNormals.length < 5) setManualNormals(prev => [...prev, num].sort((a, b) => a - b));
    };

    const toggleManualBonus = (num: number) => setManualBonus(prev => prev === num ? null : num);

    const handleAddManualTicket = () => {
        if (manualNormals.length !== 5 || manualBonus === null || maxCanStage <= 0) return;
        setStagedTickets(prev => [...prev, { normals: manualNormals, bonus: manualBonus }]);
        setManualNormals([]);
        setManualBonus(null);
    };

    const handleRemoveTicket = (indexToRemove: number) => {
        setStagedTickets(prev => prev.filter((_, idx) => idx !== indexToRemove));
    };

    const isTxPending = useRef(false);

    const handleBuy = async () => {
        if (isTxPending.current || !connected || !publicKey || !wallet || stagedTickets.length === 0 || !devnet_protocol_programid || !devnet_mock_usdc_mint_address) return;

        isTxPending.current = true;
        setTxState('loading');

        try {
            const provider = new AnchorProvider(connection, wallet.adapter as any, AnchorProvider.defaultOptions());
            const customIdl = { ...IDL };
            const lordsPotProgram = new Program(customIdl as anchor.Idl, provider);

            const formattedTickets = stagedTickets.map(ticket => ({
                normalMarbles: Buffer.from(ticket.normals),
                specialMarble: ticket.bonus
            }));

            const usdcMintPubkey = new PublicKey(devnet_mock_usdc_mint_address);
            const userUsdcAta = await getAssociatedTokenAddress(usdcMintPubkey, publicKey);

            const globalStatePda = getGlobalStatePda()[0];
            const drawingStatePda = getDrawingStatePda(current_epoch_id)[0];
            const ticketTrackerPda = getTicketTrackerPda(current_epoch_id)[0];
            const userTicketsPda = getUserTicketsPda(publicKey, current_epoch_id)[0];
            const protocolUsdcVaultAta = getProtocolUsdcVaultAta();

            const buyIx = await lordsPotProgram.methods
                .buyTickets(formattedTickets)
                .accounts({
                    signer: publicKey,
                    globalStateAccount: globalStatePda,
                    drawingStateAccount: drawingStatePda,
                    ticketTracker: ticketTrackerPda,
                    userTickets: userTicketsPda,
                    usdcMint: usdcMintPubkey,
                    buyersUsdcAccount: userUsdcAta,
                    protocolUsdcVault: protocolUsdcVaultAta,
                    tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                } as any)
                .instruction();

            const tx = new anchor.web3.Transaction().add(buyIx);
            const latestBlockhash = await connection.getLatestBlockhash('confirmed');
            tx.recentBlockhash = latestBlockhash.blockhash;
            tx.feePayer = publicKey;

            await provider.sendAndConfirm(tx, [], { commitment: "confirmed", preflightCommitment: "confirmed" });

            const purchasedAmount = stagedTickets.length;
            setStagedTickets([]);
            setLiveTotalTickets(prev => prev + purchasedAmount);
            setLiveUserTickets(prev => prev + purchasedAmount);

            setTxState('success');
            setTimeout(() => { setTxState('idle'); isTxPending.current = false; }, 3000);

        } catch (e: any) {
            console.log(e);
            if (e.message && e.message.includes("already been processed")) {
                const purchasedAmount = stagedTickets.length;
                setStagedTickets([]);
                setLiveTotalTickets(prev => prev + purchasedAmount);
                setLiveUserTickets(prev => prev + purchasedAmount);
                setTxState('success');
                setTimeout(() => { setTxState('idle'); isTxPending.current = false; }, 3000);
            } else {
                setTxState('error');
                setTimeout(() => { setTxState('idle'); isTxPending.current = false; }, 3000);
            }
        }
    };

    const displayTicketPrice = ticket_price ? (ticket_price / 1_000_000).toFixed(2) : '1.00';
    const totalCost = stagedTickets.length * parseFloat(displayTicketPrice);
    const hasInsufficientFunds = balance !== null && balance < totalCost;
    const isBalanceLoading = balance === null && connected;

    return (
        <div className="relative min-h-[calc(100vh-64px)] md:min-h-[calc(100vh-80px)] pt-4 md:pt-6 pb-12 md:pb-16 px-4 sm:px-6 overflow-hidden bg-[#0a0a0a] text-white">

            {/* 2. OVERLAY CONTROLLED BY CONTEXT */}
            {isDrawing && (
                <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md transition-opacity duration-300">
                    <div className="flex flex-col items-center justify-center p-8 bg-[#111] border border-[#D4AF37]/30 rounded-[2rem] shadow-[0_0_40px_rgba(212,175,55,0.15)]">
                        <div className="w-16 h-16 md:w-20 md:h-20 border-4 border-[#D4AF37]/10 border-t-[#D4AF37] rounded-full animate-spin mb-6" />
                        <h2 className="text-xl md:text-2xl font-black text-[#D4AF37] tracking-[0.2em] uppercase animate-pulse mb-2">
                            Oracle is Drawing...
                        </h2>
                        <p className="text-sm text-slate-400 text-center">New tickets for Epoch {ONGOING_EPOCH + 1} will be available momentarily.</p>
                    </div>
                </div>
            )}

            {txState !== 'idle' && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md transition-opacity duration-300 p-4">
                    <div className="w-56 h-56 md:w-64 md:h-64 bg-gradient-to-b from-[#1a1a1a] to-[#0d0d0d] border border-[#D4AF37]/30 rounded-[2rem] shadow-[0_0_40px_rgba(212,175,55,0.15)] flex flex-col items-center justify-center relative overflow-hidden">
                        {txState === 'loading' && (
                            <>
                                <div className="relative flex items-center justify-center mb-5">
                                    <div className="absolute w-16 h-16 md:w-20 md:h-20 border-4 border-[#D4AF37]/10 border-t-[#D4AF37] rounded-xl animate-spin" />
                                    <div className="absolute w-10 h-10 md:w-12 md:h-12 border-4 border-[#D4AF37]/30 border-b-[#D4AF37] rounded-lg animate-[spin_1.5s_reverse_infinite]" />
                                    <div className="w-4 h-4 bg-[#D4AF37] rounded-sm animate-pulse" />
                                </div>
                                <p className="text-[#D4AF37] font-bold tracking-[0.2em] text-[10px] md:text-xs animate-pulse">SECURING TICKETS...</p>
                            </>
                        )}
                        {txState === 'success' && (
                            <div className="animate-[scale-in_0.4s_cubic-bezier(0.175,0.885,0.32,1.275)] flex flex-col items-center">
                                <div className="w-16 h-16 md:w-20 md:h-20 bg-green-500/10 rounded-full flex items-center justify-center mb-3 border border-green-500/30">
                                    <svg className="w-8 h-8 md:w-10 md:h-10 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                </div>
                                <p className="text-green-400 font-black tracking-[0.1em] text-sm md:text-base drop-shadow-md">PURCHASE SUCCESSFUL</p>
                            </div>
                        )}
                        {txState === 'error' && (
                            <div className="animate-[scale-in_0.4s_cubic-bezier(0.175,0.885,0.32,1.275)] flex flex-col items-center">
                                <div className="w-16 h-16 md:w-20 md:h-20 bg-red-500/10 rounded-full flex items-center justify-center mb-3 border border-red-500/30">
                                    <svg className="w-8 h-8 md:w-10 md:h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                </div>
                                <p className="text-red-400 font-black tracking-[0.1em] text-sm md:text-base drop-shadow-md">PURCHASE FAILED</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div className="absolute top-0 inset-x-0 h-full bg-[radial-gradient(ellipse_at_top,rgba(212,175,55,0.06)_0%,transparent_65%)] pointer-events-none z-0" />

            <div className="relative z-10 w-full max-w-[500px] md:max-w-[700px] mx-auto flex flex-col items-center">
                <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-4 mb-4 md:mb-6">
                    <PulsuatingCountDown />

                    <OnGoingEpoch/>
                </div>

                <div className="flex items-center gap-2 md:gap-3 mb-6 w-full justify-center">
                    <button onClick={() => setIsHowToPlayOpen(true)} className="px-3 md:px-4 py-1.5 md:py-2 rounded-full bg-[#111] border border-[#D4AF37]/30 text-[#D4AF37] text-[9px] md:text-[10px] font-black tracking-[0.15em] md:tracking-[0.2em] uppercase hover:bg-[#D4AF37]/10 transition-colors shadow-[0_0_10px_rgba(212,175,55,0.1)]">
                        How to Play
                    </button>
                    <button onClick={() => setIsPrizeTiersOpen(true)} className="px-3 md:px-4 py-1.5 md:py-2 rounded-full bg-[#111] border border-[#D4AF37]/30 text-[#D4AF37] text-[9px] md:text-[10px] font-black tracking-[0.15em] md:tracking-[0.2em] uppercase hover:bg-[#D4AF37]/10 transition-colors shadow-[0_0_10px_rgba(212,175,55,0.1)]">
                        Prize Tiers
                    </button>
                </div>

                {!connected ? (
                    <div className="w-full flex flex-col items-center justify-center py-10 md:py-14 px-4 text-center border border-[#D4AF37]/20 rounded-[1.25rem] md:rounded-[1.5rem] bg-black/40 backdrop-blur-xl shadow-[0_4px_30px_rgba(0,0,0,0.5)] max-w-[400px] md:max-w-md mt-2">
                        <div className="w-14 h-14 md:w-16 md:h-16 bg-gradient-to-br from-[#FFD700]/10 to-[#B8860B]/5 rounded-full flex items-center justify-center mb-4 border border-[#D4AF37]/30 shadow-[0_0_30px_rgba(212,175,55,0.15)]">
                            <span className="text-3xl md:text-4xl drop-shadow-[0_0_15px_rgba(212,175,55,0.4)]">🎫</span>
                        </div>
                        <h3 className="text-lg md:text-xl font-black mb-2 uppercase tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-[#a3a3a3]">
                            Secure Your Entry
                        </h3>
                        <p className="text-[10px] md:text-xs text-[#D4AF37]/80 max-w-[280px] md:max-w-[320px] font-medium leading-relaxed mb-6 md:mb-8 italic">
                            "The jackpot awaits. Connect your wallet to pick your numbers and secure your position on the ledger."
                        </p>
                        <div className="px-5 md:px-6 py-2.5 rounded-xl border border-[#D4AF37]/50 bg-[#D4AF37]/10 text-[#D4AF37] text-[9px] md:text-[10px] font-black tracking-[0.15em] md:tracking-[0.2em] uppercase animate-pulse shadow-[0_0_15px_rgba(212,175,55,0.2)]">
                            Connect Wallet Above To Enter
                        </div>
                    </div>
                ) : (
                    <div className="w-full bg-black/40 backdrop-blur-xl border border-[#D4AF37]/20 shadow-[0_4px_30px_rgba(0,0,0,0.5)] rounded-[1.25rem] md:rounded-[1.5rem] p-4 md:p-6 relative overflow-hidden flex flex-col h-[600px] md:h-[620px]">
                        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#D4AF37] to-transparent opacity-40" />

                        <div className="flex flex-col sm:flex-row gap-2 md:gap-3 shrink-0 mb-4 md:mb-5">
                            <div className="flex-1 bg-[#111] border border-white/5 rounded-lg md:rounded-xl p-2.5 md:p-3 flex flex-col justify-center">
                                <div className="flex justify-between items-center mb-1.5">
                                    <span className="text-[9px] md:text-[10px] font-bold tracking-[0.1em] text-slate-400 uppercase">Total Bought in this epoch</span>
                                    <span className="text-[9px] md:text-[10px] font-black text-[#D4AF37]">{liveTotalTickets}/{GLOBAL_MAX}</span>
                                </div>
                                <div className="w-full h-1 bg-black rounded-full overflow-hidden">
                                    <div className={`h-full ${isGlobalFull ? 'bg-red-500' : 'bg-gradient-to-r from-[#D4AF37]/50 to-[#D4AF37]'}`} style={{ width: `${Math.min((liveTotalTickets / GLOBAL_MAX) * 100, 100)}%` }} />
                                </div>
                            </div>

                            <div className="flex-1 bg-[#111] border border-white/5 rounded-lg md:rounded-xl p-2.5 md:p-3 flex flex-col justify-center">
                                <div className="flex justify-between items-center mb-1.5">
                                    <span className="text-[9px] md:text-[10px] font-bold tracking-[0.1em] text-slate-400 uppercase">Your Bought Tickets</span>
                                    <span className="text-[9px] md:text-[10px] font-black text-[#D4AF37]">{liveUserTickets}/{USER_MAX}</span>
                                </div>
                                <div className="w-full h-1 bg-black rounded-full overflow-hidden">
                                    <div className={`h-full ${isUserFull ? 'bg-red-500' : 'bg-gradient-to-r from-purple-500/50 to-purple-500'}`} style={{ width: `${Math.min((liveUserTickets / USER_MAX) * 100, 100)}%` }} />
                                </div>
                            </div>
                        </div>

                        <div className="h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent shrink-0 mb-3 md:mb-4" />

                        <div className="shrink-0 mb-4">
                            <div className="flex justify-between items-end mb-3 md:mb-4">
                                <div className="flex gap-3 md:gap-5 border-b border-white/10 pb-1.5">
                                    <button onClick={() => setActiveTab('quick')} className={`text-[10px] md:text-[11px] font-black tracking-[0.1em] uppercase transition-colors ${activeTab === 'quick' ? 'text-[#D4AF37]' : 'text-slate-500 hover:text-slate-300'}`}>
                                        Quick Pick
                                    </button>
                                    <button onClick={() => setActiveTab('manual')} className={`text-[10px] md:text-[11px] font-black tracking-[0.1em] uppercase transition-colors ${activeTab === 'manual' ? 'text-[#D4AF37]' : 'text-slate-500 hover:text-slate-300'}`}>
                                        Manual Pick
                                    </button>
                                </div>

                                <span className={`text-[9px] md:text-[10px] font-bold tracking-wider pb-1.5 ${isGlobalFull || isUserFull ? 'text-red-400 animate-pulse' : 'text-slate-500'}`}>
                                    {isGlobalFull ? 'GLOBAL EPOCH SOLD OUT' :
                                        isUserFull ? 'VAULT LIMIT REACHED' :
                                            `${maxCanStage} slots left`}
                                </span>
                            </div>

                            {activeTab === 'quick' && (
                                <div className="flex gap-3 animate-fade-in">
                                    <div className={`flex items-center justify-between bg-[#0d0d0d] border border-white/10 rounded-md md:rounded-lg p-1 w-28 md:w-32 shrink-0 ${maxCanStage === 0 ? 'opacity-50' : ''}`}>
                                        <button
                                            onClick={() => setGenCount(Math.max(1, (Number(genCount) || 0) - 1))}
                                            disabled={Number(genCount) <= 1 || maxCanStage === 0}
                                            className="w-8 h-8 md:w-10 md:h-10 flex items-center justify-center text-lg md:text-xl text-slate-400 hover:text-[#D4AF37] transition-colors rounded hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
                                        >
                                            −
                                        </button>

                                        <input
                                            type="number" min="1" max={maxCanStage}
                                            value={genCount} onChange={handleGenCountChange} onBlur={handleGenCountBlur}
                                            disabled={maxCanStage === 0}
                                            className="w-8 md:w-10 text-center bg-transparent text-sm md:text-base font-black text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:cursor-not-allowed"
                                        />

                                        <button
                                            onClick={() => setGenCount(Math.min(maxCanStage, (Number(genCount) || 0) + 1))}
                                            disabled={Number(genCount) >= maxCanStage || maxCanStage === 0}
                                            className="w-8 h-8 md:w-10 md:h-10 flex items-center justify-center text-lg md:text-xl text-slate-400 hover:text-[#D4AF37] transition-colors rounded hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
                                        >
                                            +
                                        </button>
                                    </div>
                                    <button onClick={handleGenerateRandom} disabled={maxCanStage === 0} className="flex-1 bg-[#D4AF37]/10 border border-[#D4AF37]/30 hover:bg-[#D4AF37]/20 text-[#D4AF37] text-[9px] md:text-[10px] font-black tracking-[0.15em] uppercase rounded-md md:rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 py-2 sm:py-0 active:scale-95">
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                        Generate
                                    </button>
                                </div>
                            )}

                            {activeTab === 'manual' && (
                                <div className="flex flex-col gap-3 md:gap-4 animate-fade-in">
                                    <div className={maxCanStage === 0 ? 'opacity-50 pointer-events-none' : ''}>
                                        <div className="flex justify-between items-center mb-1.5 md:mb-2">
                                            <span className="text-[9px] md:text-[10px] font-bold text-slate-400 tracking-[0.1em] uppercase">
                                                Select 5 Numbers (1-{normal_marble_max || 30})
                                            </span>
                                            <span className="text-[9px] md:text-[10px] font-black text-[#D4AF37]">{manualNormals.length}/5</span>
                                        </div>
                                        <div className="grid grid-cols-10 md:grid-cols-[repeat(15,minmax(0,1fr))] gap-1 md:gap-1.5">
                                            {Array.from({ length: normal_marble_max || 30 }, (_, i) => i + 1).map(num => {
                                                const isSelected = manualNormals.includes(num);
                                                const isDisabled = (!isSelected && manualNormals.length >= 5) || maxCanStage === 0;
                                                return (
                                                    <button key={`n-${num}`} onClick={() => toggleManualNormal(num)} disabled={isDisabled} className={`w-full aspect-square rounded-full flex items-center justify-center text-[9px] md:text-[10px] font-bold transition-all ${isSelected ? 'bg-white text-black shadow-[0_0_6px_rgba(255,255,255,0.3)] scale-105' : 'bg-[#111] text-slate-400 border border-white/5 hover:border-white/20'} ${isDisabled ? 'opacity-30 cursor-not-allowed hover:border-white/5' : ''}`}>
                                                        {num}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </div>

                                    <div className={maxCanStage === 0 ? 'opacity-50 pointer-events-none' : ''}>
                                        <div className="flex justify-between items-center mb-1.5 md:mb-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[9px] md:text-[10px] font-bold text-[#D4AF37]/80 tracking-[0.1em] uppercase">Select 1 Lord Ball (1-{special_marble_max || 12})</span>
                                                {manualNormals.length === 5 && manualBonus === null && maxCanStage > 0 && (
                                                    <span className="text-[8px] md:text-[9px] text-red-500 font-bold animate-pulse tracking-wide uppercase">
                                                        ← Pick to complete
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-[9px] md:text-[10px] font-black text-[#D4AF37]">{manualBonus ? '1' : '0'}/1</span>
                                        </div>
                                        <div className="grid grid-cols-6 md:grid-cols-12 gap-1 md:gap-1.5">
                                            {Array.from({ length: special_marble_max || 12 }, (_, i) => i + 1).map(num => {
                                                const isSelected = manualBonus === num;
                                                return (
                                                    <button key={`b-${num}`} onClick={() => toggleManualBonus(num)} disabled={maxCanStage === 0} className={`w-full aspect-square rounded-full flex items-center justify-center text-[9px] md:text-[10px] font-black transition-all ${isSelected ? 'bg-gradient-to-br from-[#FFD700] to-[#B8860B] text-black shadow-[0_0_8px_rgba(212,175,55,0.4)] ring-1 ring-[#FFD700]/30 scale-105' : 'bg-[#111] text-[#D4AF37]/50 border border-[#D4AF37]/20 hover:border-[#D4AF37]/60 hover:text-[#D4AF37] disabled:opacity-30 disabled:cursor-not-allowed'}`}>
                                                        {num}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </div>

                                    <button onClick={handleAddManualTicket} disabled={manualNormals.length !== 5 || manualBonus === null || maxCanStage === 0} className="w-full py-2 bg-[#D4AF37]/10 border border-[#D4AF37]/30 hover:bg-[#D4AF37]/20 text-[#D4AF37] text-[9px] md:text-[10px] font-black tracking-[0.15em] uppercase rounded-md md:rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 active:scale-95">
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                                        STAGE TICKET
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="bg-[#111]/50 border border-white/5 rounded-xl md:rounded-2xl p-2.5 md:p-3 flex-1 flex flex-col min-h-0 mb-4">
                            <div className="flex justify-between items-center mb-2 px-1 shrink-0">
                                <span className="text-[9px] md:text-[10px] font-bold tracking-[0.15em] text-slate-400 uppercase">
                                    Staged Tickets ({stagedTickets.length})
                                </span>
                                {stagedTickets.length > 0 && (
                                    <button onClick={() => setStagedTickets([])} className="text-[9px] md:text-[10px] font-bold text-red-400 hover:text-red-300 tracking-wider uppercase transition-colors">
                                        Clear All
                                    </button>
                                )}
                            </div>

                            {stagedTickets.length === 0 ? (
                                <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-1.5 opacity-50">
                                    <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                                    <span className="text-[8px] md:text-[9px] font-bold tracking-widest uppercase">No tickets generated</span>
                                </div>
                            ) : (
                                <div className="flex-1 overflow-y-auto pr-1 space-y-1.5 md:space-y-2 scrollbar-thin scrollbar-thumb-[#D4AF37]/30 scrollbar-track-transparent">
                                    {stagedTickets.map((ticket, i) => (
                                        <div key={i} className="flex justify-between items-center bg-[#0a0a0a] border border-white/5 rounded-md md:rounded-lg p-1.5 md:p-2 hover:border-[#D4AF37]/30 transition-colors group">
                                            <div className="flex items-center">
                                                <span className="text-[#D4AF37]/50 font-black text-[8px] md:text-[9px] w-4 mr-1 md:mr-2 text-center">{(i + 1)}</span>
                                                <div className="flex gap-1 md:gap-1.5">
                                                    {ticket.normals.map((num, idx) => (
                                                        <div key={idx} className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-[#111] border border-white/10 flex items-center justify-center text-[8px] md:text-[9px] font-bold text-slate-300 shadow-inner">
                                                            {num}
                                                        </div>
                                                    ))}
                                                    <div className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-gradient-to-br from-[#FFD700] to-[#B8860B] flex items-center justify-center text-[8px] md:text-[9px] font-black text-black shadow-[0_0_4px_rgba(212,175,55,0.3)] ring-[0.5px] ring-[#FFD700]/50 ml-0.5 md:ml-1">
                                                        {ticket.bonus}
                                                    </div>
                                                </div>
                                            </div>
                                            <button onClick={() => handleRemoveTicket(i)} className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white flex items-center justify-center transition-colors opacity-100 lg:opacity-0 group-hover:opacity-100">
                                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="shrink-0 mt-auto">
                            <BalanceDisplay balance={balance} />
                            <button
                                onClick={handleBuy}
                                disabled={txState !== 'idle' || !connected || stagedTickets.length === 0 || hasInsufficientFunds || isBalanceLoading || isDrawing}
                                className="relative w-full py-3 md:py-3.5 overflow-hidden group rounded-lg md:rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center p-0 active:scale-95"
                            >
                                <div className="absolute inset-0 bg-gradient-to-r from-[#B8860B] via-[#FFD700] to-[#B8860B] bg-[length:200%_100%] animate-[gradient_2s_linear_infinite]" />
                                <div className="absolute inset-[1.5px] bg-[#111] rounded-[6px] md:rounded-[10px] group-hover:bg-transparent transition-colors duration-300 z-0" />
                                <span className="relative z-10 text-[10px] md:text-[11px] font-black tracking-[0.15em] md:tracking-[0.2em] text-[#D4AF37] group-hover:text-black transition-colors duration-300 leading-none">
                                    {txState === 'loading'
                                        ? "CONFIRMING..."
                                        : stagedTickets.length === 0
                                            ? "STAGE TICKETS TO BUY"
                                            : isBalanceLoading
                                                ? "LOADING BALANCE..."
                                                : hasInsufficientFunds
                                                    ? `INSUFFICIENT LUSDC • NEED $${totalCost.toFixed(2)}`
                                                    : `BUY TICKETS • $${totalCost.toFixed(2)}`}
                                </span>
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {isHowToPlayOpen && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in" onClick={() => setIsHowToPlayOpen(false)}>
                    <div className="bg-[#0a0a0a] border border-[#D4AF37]/30 shadow-[0_0_30px_rgba(212,175,55,0.15)] rounded-[1.5rem] md:rounded-[2rem] p-5 md:p-6 max-w-[280px] md:max-w-xs w-full relative" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setIsHowToPlayOpen(false)} className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors">
                            <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                        <h2 className="text-xl md:text-2xl font-black uppercase tracking-tighter mb-4 md:mb-6 text-center text-transparent bg-clip-text bg-gradient-to-b from-white to-[#a3a3a3]">
                            Match Numbers,<br/>Win Prizes
                        </h2>
                        <div className="space-y-4 md:space-y-5 mb-6 md:mb-8">
                            <div className="flex gap-3 items-start">
                                <div className="w-8 h-8 md:w-10 md:h-10 shrink-0 bg-[#D4AF37]/10 rounded-full border border-[#D4AF37]/30 flex items-center justify-center text-lg md:text-xl">🎯</div>
                                <div>
                                    <h4 className="text-xs md:text-sm font-bold text-white tracking-wide">Pick, Match, Win</h4>
                                    <p className="text-[10px] md:text-xs text-slate-400 mt-0.5">Match just one number to win a prize, or match all 6 to hit the grand jackpot.</p>
                                </div>
                            </div>
                            <div className="flex gap-3 items-start">
                                <div className="w-8 h-8 md:w-10 md:h-10 shrink-0 bg-[#D4AF37]/10 rounded-full border border-[#D4AF37]/30 flex items-center justify-center text-lg md:text-xl">🏆</div>
                                <div>
                                    <h4 className="text-xs md:text-sm font-bold text-white tracking-wide">Real Winners Every Day</h4>
                                    <p className="text-[10px] md:text-xs text-slate-400 mt-0.5">The vault constantly pays out rewards automatically directly to connected wallets.</p>
                                </div>
                            </div>
                            <div className="flex gap-3 items-start">
                                <div className="w-8 h-8 md:w-10 md:h-10 shrink-0 bg-[#D4AF37]/10 rounded-full border border-[#D4AF37]/30 flex items-center justify-center text-lg md:text-xl">🔒</div>
                                <div>
                                    <h4 className="text-xs md:text-sm font-bold text-white tracking-wide">100% On-Chain Random</h4>
                                    <p className="text-[10px] md:text-xs text-slate-400 mt-0.5">Numbers are drawn fully on-chain securely. Provably fair and transparent.</p>
                                </div>
                            </div>
                        </div>
                        <button onClick={() => setIsHowToPlayOpen(false)} className="w-full py-2.5 md:py-3 bg-white text-black text-[10px] md:text-xs font-black tracking-[0.2em] rounded-lg md:rounded-xl hover:bg-[#D4AF37] transition-colors uppercase active:scale-95">
                            I'm ready to play
                        </button>
                    </div>
                </div>
            )}

            {isPrizeTiersOpen && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in" onClick={() => setIsPrizeTiersOpen(false)}>
                    <div className="bg-[#0a0a0a] border border-[#D4AF37]/30 shadow-[0_0_20px_rgba(212,175,55,0.15)] rounded-xl md:rounded-2xl p-3 md:p-4 max-w-[240px] md:max-w-[260px] w-full relative flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setIsPrizeTiersOpen(false)} className="absolute top-2.5 right-2.5 md:top-3 md:right-3 text-slate-500 hover:text-white transition-colors z-10">
                            <svg className="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                        <h2 className="text-sm md:text-base font-black uppercase tracking-tighter mb-0.5 text-transparent bg-clip-text bg-gradient-to-b from-white to-[#a3a3a3]">Prize Tiers</h2>
                        <p className="text-[7px] md:text-[8px] text-slate-400 mb-2 md:mb-2.5">5 numbers (1-{normal_marble_max}) + 1 Lord ball (1-{special_marble_max}) drawn dynamically.</p>
                        <div className="flex justify-between text-[7px] md:text-[8px] font-bold text-[#D4AF37] tracking-[0.1em] uppercase border-b border-white/10 pb-1 mb-1.5 px-1">
                            <span>Numbers Matched</span>
                            <span>Prize</span>
                        </div>
                        <div className="overflow-y-auto pr-1 space-y-0.5 scrollbar-thin scrollbar-thumb-[#D4AF37]/30">
                            {[
                                { normals: 5, bonus: 1, text: "5 numbers + 1 bonus", prize: "Jackpot" },
                                { normals: 5, bonus: 0, text: "5 numbers", prize: "$3,208.17" },
                                { normals: 4, bonus: 1, text: "4 numbers + 1 bonus", prize: "$283.23" },
                                { normals: 4, bonus: 0, text: "4 numbers", prize: "$26.65" },
                                { normals: 3, bonus: 1, text: "3 numbers + 1 bonus", prize: "$12.75" },
                                { normals: 2, bonus: 1, text: "2 numbers + 1 bonus", prize: "$4.06" },
                                { normals: 3, bonus: 0, text: "3 numbers", prize: "$3.13" },
                                { normals: 1, bonus: 1, text: "1 number + 1 bonus", prize: "$2.11" },
                                { normals: 2, bonus: 0, text: "2 numbers", prize: "$0.00" },
                                { normals: 0, bonus: 1, text: "1 bonus", prize: "$0.00" },
                            ].map((tier, idx) => (
                                <div key={idx} className="flex justify-between items-center bg-[#111] p-1 md:p-1.5 rounded-md border border-white/5">
                                    <div className="flex flex-col gap-[1px]">
                                        <div className="flex gap-[2px] items-center">
                                            {Array.from({ length: tier.normals }).map((_, i) => (
                                                <div key={i} className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-[#1a1a1a] text-slate-400 border border-white/5 text-[5px] md:text-[6px] flex items-center justify-center font-bold">N</div>
                                            ))}
                                            {tier.bonus === 1 && (
                                                <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-[#D4AF37] text-black shadow-[0_0_2px_rgba(212,175,55,0.4)] text-[5px] md:text-[6px] flex items-center justify-center font-black ml-[2px]">L</div>
                                            )}
                                        </div>
                                        <span className="text-[6px] md:text-[7px] text-slate-400">{tier.text}</span>
                                    </div>
                                    <span className="text-[8px] md:text-[9px] font-black text-white">{tier.prize}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};