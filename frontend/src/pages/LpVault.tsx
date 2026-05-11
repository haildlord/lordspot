import { useCallback, useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useAppData } from '../context/AppDataContext';
import { getAssociatedTokenAddress } from "@solana/spl-token";
import {
    DEVNET_LUSDC_MINT,
    getGlobalStatePda,
    getDrawingStatePda,
    getLpDrawingStatePda,
    getPerEpochStatePda,
    getProtocolUsdcVaultAta,
    getLpInfoPda
} from "../utility/seeds_and_ata.ts";

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import IDL from '../idl/lords_pot.json';
import { useUserBalance, BalanceDisplay } from '../components/UsersLusdcBalanceFetcher';
import { PulsuatingCountDown } from "../components/PulsuatingCountDown.tsx";
import { OnGoingEpoch } from "../components/OnGoingEpoch.tsx";

export const LpVault = () => {
    const { connected, publicKey, wallet } = useWallet();
    const { connection } = useConnection();

    const {
        pool_total_cap,
        prize_pool,
        lpInfo,
        activityLogs,
        refreshVaultData,
        devnet_protocol_programid,
        current_epoch_id,
        isDrawing,
        lp_target_percent,
        lastEpochUpdate
    } = useAppData();

    const formattedLpPercent = Number(((lp_target_percent / 1e12) * 100).toFixed(2));
    const { balance, fetchBalance } = useUserBalance();

    const [globalPendingDepositsMicro, setGlobalPendingDepositsMicro] = useState<number>(0);
    const [isHowItWorksOpen, setIsHowItWorksOpen] = useState(false);
    const [depositAmount, setDepositAmount] = useState<number | ''>('');
    const [txState, setTxState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

    // Withdrawal State
    const [withdrawPercent, setWithdrawPercent] = useState<number>(0);

    const fetchGlobalPoolState = useCallback(async () => {
        if (!connection || !devnet_protocol_programid) return;
        try {
            const provider = new AnchorProvider(connection, wallet?.adapter as any || {}, AnchorProvider.defaultOptions());
            const customIdl = { ...IDL, address: devnet_protocol_programid };
            const program = new Program(customIdl as anchor.Idl, provider);
            let lpDrawingStatePda = getLpDrawingStatePda(current_epoch_id)[0];
            const drawingState = await program.account.epochIdToLpDrawingState.fetch(lpDrawingStatePda);
            setGlobalPendingDepositsMicro(drawingState.pendingDeposits.toNumber());
        } catch (e) {
            setGlobalPendingDepositsMicro(0);
        }
    }, [connection, devnet_protocol_programid, current_epoch_id, wallet]);

    useEffect(() => {
        fetchGlobalPoolState();
        const intervalId = setInterval(fetchGlobalPoolState, 10000);
        return () => clearInterval(intervalId);
    }, [fetchGlobalPoolState]);

    useEffect(() => {
        fetchGlobalPoolState();
        fetchBalance();
    }, [lastEpochUpdate, fetchGlobalPoolState, fetchBalance]);

    // CAPACITY MATH
    const targetCapMicro = pool_total_cap;
    const finalizedPoolMicro = prize_pool;
    const rightNowCapMicro = finalizedPoolMicro + globalPendingDepositsMicro;
    const remainingCapacityMicro = Math.max(0, targetCapMicro - rightNowCapMicro);

    const rightNowCap = rightNowCapMicro / 1e6;
    const targetCap = targetCapMicro / 1e6;
    const remainingCapacityDisplay = remainingCapacityMicro / 1e6;

    const fillPercentage = Math.min((rightNowCap / targetCap) * 100, 100);
    const isPoolFull = remainingCapacityMicro <= 0;
    const exceedsCapacity = typeof depositAmount === 'number' && depositAmount > remainingCapacityDisplay;

    // --- THE 3-STATE POSITION LOGIC ---
    // Extracting values from your TrueLpState
    const activeShares = lpInfo ? lpInfo.consolidatedShares : 0;
    const pendingWithdrawalShares = lpInfo ? lpInfo.pendingWithdrawalShares : 0;
    const pendingWithdrawalEpoch = lpInfo ? lpInfo.pendingWithdrawalEpoch : 0;
    const claimableUsdcMicro = lpInfo ? lpInfo.claimableUsdc : 0;

    // Convert internal Shares to frontend-friendly USDC estimates (divide by 1e6)
    const activeUsdcEstimate = activeShares / 1e6;
    const pendingWithdrawalUsdcEstimate = pendingWithdrawalShares / 1e6;

    // Calculating the underlying shares to burn based on percentage
    const sharesToBurn = Math.floor(activeShares * (withdrawPercent / 100));
    const withdrawValueUsdcEstimate = sharesToBurn / 1e6;

    // State Triggers
    const isPendingCurrentEpoch = pendingWithdrawalShares > 0 && pendingWithdrawalEpoch === current_epoch_id;
    const isReadyToFinalize = (pendingWithdrawalShares > 0 && pendingWithdrawalEpoch < current_epoch_id) || claimableUsdcMicro > 0;

    // --- ANCHOR METHODS ---
    const getProgramInstance = () => {
        const provider = new AnchorProvider(connection, wallet!.adapter as any, AnchorProvider.defaultOptions());
        const customIdl = { ...IDL, address: devnet_protocol_programid };
        return new Program(customIdl as anchor.Idl, provider);
    };

    const handleDeposit = async () => {
        if (!connected || !publicKey || !wallet || !devnet_protocol_programid || !depositAmount || isPoolFull || exceedsCapacity) return;
        setTxState('loading');

        try {
            const lordsPotProgram = getProgramInstance();
            const userUsdcAta = await getAssociatedTokenAddress(DEVNET_LUSDC_MINT, publicKey);

            let amountInMicroUsdc: BN;
            if (depositAmount === remainingCapacityDisplay) {
                amountInMicroUsdc = new BN(remainingCapacityMicro);
            } else {
                amountInMicroUsdc = new BN(Math.floor(depositAmount * 1e6));
            }

            const needsConsolidation = lpInfo !== null && lpInfo.rawPendingDepositAmount > 0 && lpInfo.rawLastDepositEpoch < current_epoch_id;
            const historicalEpochPda = needsConsolidation ? getPerEpochStatePda(lpInfo.rawLastDepositEpoch)[0] : null;
            const prevEpochPda = current_epoch_id > 0 ? getPerEpochStatePda(current_epoch_id - 1)[0] : null;

            const signature = await lordsPotProgram.methods
                .lpDeposit(amountInMicroUsdc)
                .accounts({
                    signer: publicKey,
                    usdcMint: DEVNET_LUSDC_MINT,
                    globalStateAccount: getGlobalStatePda()[0],
                    drawingStateAccount: getDrawingStatePda(current_epoch_id)[0],
                    drawingIdToLpDrawingState: getLpDrawingStatePda(current_epoch_id)[0],
                    lpMintAccount: userUsdcAta,
                    protocolUsdcVault: getProtocolUsdcVaultAta(),
                    lpInfoAccount: getLpInfoPda(publicKey)[0],
                    depositEpochState: historicalEpochPda,
                    prevPerEpochState: prevEpochPda,
                    tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
                } as any)
                .rpc();

            setTxState('success');
            setDepositAmount('');
            await refreshVaultData();
            await fetchBalance();
            await fetchGlobalPoolState();
            setTimeout(() => setTxState('idle'), 3000);
        } catch (e: any) {
            console.error("Deposit Error:", e);
            setTxState('error');
            setTimeout(() => setTxState('idle'), 3000);
        }
    };

    const handleInitiateWithdraw = async () => {
        if (!connected || !publicKey || sharesToBurn <= 0) return;
        setTxState('loading');

        try {
            const lordsPotProgram = getProgramInstance();

            const prevDepositEpochPda = (lpInfo && lpInfo.rawPendingDepositAmount > 0 && lpInfo.rawLastDepositEpoch < current_epoch_id)
                ? getPerEpochStatePda(lpInfo.rawLastDepositEpoch)[0]
                : null;

            // FIX APPLIED HERE: Using rawPendingWithdrawalShares
            const prevWithdrawalEpochPda = (lpInfo && lpInfo.rawPendingWithdrawalShares > 0 && lpInfo.pendingWithdrawalEpoch < current_epoch_id)
                ? getPerEpochStatePda(lpInfo.pendingWithdrawalEpoch)[0]
                : null;

            const signature = await lordsPotProgram.methods
                .lpInitiateWithdraw(new BN(sharesToBurn))
                .accounts({
                    signer: publicKey,
                    globalStateAccount: getGlobalStatePda()[0],
                    drawingStateAccount: getDrawingStatePda(current_epoch_id)[0],
                    drawingIdToLpDrawingState: getLpDrawingStatePda(current_epoch_id)[0],
                    lpInfoAccount: getLpInfoPda(publicKey)[0],
                    depositEpochState: prevDepositEpochPda,
                    withdrawalEpochState: prevWithdrawalEpochPda,
                } as any)
                .rpc();

            setTxState('success');
            setWithdrawPercent(0);
            await refreshVaultData();
            setTimeout(() => setTxState('idle'), 3000);
        } catch (e) {
            console.error("Initiate Withdraw Error:", e);
            setTxState('error');
            setTimeout(() => setTxState('idle'), 3000);
        }
    };

    const handleFinalizeWithdraw = async () => {
        if (!connected || !publicKey || !isReadyToFinalize) return;
        setTxState('loading');

        try {
            const lordsPotProgram = getProgramInstance();
            const userUsdcAta = await getAssociatedTokenAddress(DEVNET_LUSDC_MINT, publicKey);

            // FIX APPLIED HERE: Using rawPendingWithdrawalShares
            const prevWithdrawalEpochPda = (lpInfo && lpInfo.rawPendingWithdrawalShares > 0 && lpInfo.pendingWithdrawalEpoch < current_epoch_id)
                ? getPerEpochStatePda(lpInfo.pendingWithdrawalEpoch)[0]
                : null;

            const signature = await lordsPotProgram.methods
                .lpFinalizeWithdraw()
                .accounts({
                    signer: publicKey,
                    usdcMint: DEVNET_LUSDC_MINT,
                    globalStateAccount: getGlobalStatePda()[0],
                    drawingStateAccount: getDrawingStatePda(current_epoch_id)[0],
                    drawingIdToLpDrawingState: getLpDrawingStatePda(current_epoch_id)[0],
                    lpInfoAccount: getLpInfoPda(publicKey)[0],
                    withdrawalEpochState: prevWithdrawalEpochPda,
                    userUsdcAccount: userUsdcAta,
                    protocolUsdcVault: getProtocolUsdcVaultAta(),
                    tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
                } as any)
                .rpc();

            setTxState('success');
            await refreshVaultData();
            await fetchBalance();
            setTimeout(() => setTxState('idle'), 3000);
        } catch (e) {
            console.error("Finalize Withdraw Error:", e);
            setTxState('error');
            setTimeout(() => setTxState('idle'), 3000);
        }
    };

    return (
        <div className="relative min-h-[calc(100vh-64px)] md:min-h-[calc(100vh-80px)] pt-4 md:pt-6 pb-12 md:pb-16 px-4 sm:px-6 overflow-hidden bg-[#0a0a0a] text-white">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 mb-4 md:mb-6">
                <PulsuatingCountDown />
                <OnGoingEpoch/>
            </div>

            {/* OVERLAYS & MODALS */}
            {isDrawing && (
                <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md transition-opacity duration-300">
                    <div className="flex flex-col items-center justify-center p-8 bg-[#111] border border-[#D4AF37]/30 rounded-[2rem] shadow-[0_0_40px_rgba(212,175,55,0.15)]">
                        <div className="w-16 h-16 md:w-20 md:h-20 border-4 border-[#D4AF37]/10 border-t-[#D4AF37] rounded-full animate-spin mb-6" />
                        <h2 className="text-xl md:text-2xl font-black text-[#D4AF37] tracking-[0.2em] uppercase animate-pulse mb-2">Oracle is Drawing...</h2>
                        <p className="text-sm text-slate-400 text-center">Vault interactions are disabled while winners are paid out.</p>
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
                                <p className="text-[#D4AF37] font-bold tracking-[0.2em] text-[10px] md:text-xs animate-pulse">PROCESSING...</p>
                            </>
                        )}
                        {txState === 'success' && (
                            <div className="animate-[scale-in_0.4s_cubic-bezier(0.175,0.885,0.32,1.275)] flex flex-col items-center">
                                <div className="w-16 h-16 md:w-20 md:h-20 bg-green-500/10 rounded-full flex items-center justify-center mb-3 border border-green-500/30">
                                    <svg className="w-8 h-8 md:w-10 md:h-10 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                </div>
                                <p className="text-green-400 font-black tracking-[0.1em] text-sm md:text-base drop-shadow-md">SUCCESS</p>
                            </div>
                        )}
                        {txState === 'error' && (
                            <div className="animate-[scale-in_0.4s_cubic-bezier(0.175,0.885,0.32,1.275)] flex flex-col items-center">
                                <div className="w-16 h-16 md:w-20 md:h-20 bg-red-500/10 rounded-full flex items-center justify-center mb-3 border border-red-500/30">
                                    <svg className="w-8 h-8 md:w-10 md:h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                </div>
                                <p className="text-red-400 font-black tracking-[0.1em] text-sm md:text-base drop-shadow-md">FAILED</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <style>{`
                @keyframes shimmer-sweep {
                    0% { transform: translateX(-100%) skewX(-15deg); }
                    100% { transform: translateX(200%) skewX(-15deg); }
                }
                .animate-shimmer {
                    animation: shimmer-sweep 2.5s infinite linear;
                }
            `}</style>

            <div className="absolute top-0 inset-x-0 h-full bg-[radial-gradient(ellipse_at_top,rgba(212,175,55,0.06)_0%,transparent_65%)] pointer-events-none z-0" />

            <div className="relative z-10 w-full max-w-[480px] md:max-w-2xl mx-auto flex flex-col items-center">
                <div className="flex items-center justify-between w-full mb-4 md:mb-6 px-1">
                    <h1 className="text-xl md:text-2xl font-black uppercase tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-[#a3a3a3]">
                        LP VAULT
                    </h1>
                    <button onClick={() => setIsHowItWorksOpen(true)} className="px-3 md:px-4 py-1.5 rounded-full bg-[#111] border border-[#D4AF37]/30 text-[#D4AF37] text-[9px] md:text-[10px] font-black tracking-[0.15em] md:tracking-[0.2em] uppercase hover:bg-[#D4AF37]/10 transition-colors shadow-[0_0_10px_rgba(212,175,55,0.1)]">
                        How it works
                    </button>
                </div>

                {/* PRIZE POOL HEADER */}
                <div className="w-full mb-6 md:mb-8">
                    <h3 className="text-[10px] md:text-xs font-black tracking-[0.15em] text-slate-400 uppercase mb-2 md:mb-3 px-1 flex items-center gap-1.5">Prize Pool</h3>
                    <div className="w-full bg-black/40 backdrop-blur-xl border border-[#D4AF37]/20 shadow-[0_4px_20px_rgba(0,0,0,0.5)] rounded-[1.25rem] md:rounded-[1.5rem] p-3 md:p-5 relative overflow-hidden flex flex-col">
                        <div className="absolute top-0 left-0 w-full h-[1.5px] bg-gradient-to-r from-transparent via-[#D4AF37] to-transparent opacity-40" />

                        <div className="flex justify-between items-end mb-1.5 md:mb-2 px-1">
                            <div>
                                <p className="text-[10px] md:text-xs font-bold text-slate-300">
                                    Total Vault <span className="text-white font-black">${rightNowCap.toLocaleString()}</span>
                                </p>
                                {globalPendingDepositsMicro > 0 && (
                                    <p className="text-[8px] md:text-[9px] text-[#D4AF37] font-medium mt-0.5">
                                        Includes ${(globalPendingDepositsMicro / 1e6).toLocaleString()} pending this epoch
                                    </p>
                                )}
                            </div>
                            <p className="text-[9px] md:text-[10px] font-bold text-slate-500 text-right">
                                Cap: ${targetCap.toLocaleString()}
                                <br/>
                                <span className={remainingCapacityDisplay <= 0 ? "text-red-400" : "text-emerald-400"}>
                                ${remainingCapacityDisplay.toLocaleString()} Left
                                </span>
                            </p>
                        </div>

                        <div className="w-full h-1.5 md:h-2 bg-[#050505] rounded-full overflow-hidden border border-white/5 mb-4 md:mb-5 relative shadow-inner">
                            <div className={`h-full relative overflow-hidden transition-all duration-500 ${remainingCapacityDisplay > 0 ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]'}`} style={{ width: `${fillPercentage}%` }}>
                                <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-shimmer" />
                            </div>
                        </div>
                    </div>
                </div>

                {!connected ? (
                    <div className="w-full flex flex-col items-center justify-center py-12 md:py-16 px-4 text-center border border-[#D4AF37]/20 rounded-[1.5rem] md:rounded-[2rem] bg-black/40 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
                        <div className="w-16 h-16 md:w-20 md:h-20 bg-gradient-to-br from-[#FFD700]/10 to-[#B8860B]/5 rounded-full flex items-center justify-center mb-4 border border-[#D4AF37]/30 shadow-[0_0_30px_rgba(212,175,55,0.15)]">
                            <span className="text-4xl md:text-5xl drop-shadow-[0_0_15px_rgba(212,175,55,0.4)]">🏰</span>
                        </div>
                        <h3 className="text-xl md:text-2xl font-black mb-2 uppercase tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-[#a3a3a3]">The Gates are Sealed</h3>
                        <p className="text-[10px] md:text-xs text-[#D4AF37]/80 max-w-[280px] md:max-w-sm font-medium leading-relaxed mb-6 italic">"Prove your worth. Connect your wallet to fund the kingdom's treasury. If the Lord finds you favorable, you might just claim a slice of the throne."</p>
                        <div className="px-6 py-2.5 rounded-xl border border-[#D4AF37]/50 bg-[#D4AF37]/10 text-[#D4AF37] text-[9px] md:text-[10px] font-black tracking-[0.2em] uppercase animate-pulse shadow-[0_0_15px_rgba(212,175,55,0.2)]">Connect Wallet Above To Enter</div>
                    </div>
                ) : (
                    <div className="w-full flex flex-col gap-6 md:gap-8">

                        {/* THE DEPOSIT SECTION */}
                        <div className="w-full">
                            <h3 className="text-[10px] md:text-xs font-black tracking-[0.15em] text-slate-400 uppercase mb-2 md:mb-3 px-1">Deposit</h3>
                            <div className="w-full bg-[#0d0d0d] border border-[#D4AF37]/30 shadow-[0_8px_30px_rgba(212,175,55,0.1)] rounded-[1.5rem] md:rounded-[2rem] p-6 md:p-8 relative overflow-hidden flex flex-col items-center">
                                <div className="absolute bottom-0 inset-x-0 h-1/2 opacity-10 pointer-events-none flex items-end gap-1 px-4">
                                    {Array.from({length: 15}).map((_, i) => (
                                        <div key={i} className="flex-1 bg-gradient-to-t from-[#D4AF37] to-transparent rounded-t-sm" style={{ height: `${Math.random() * 100}%` }} />
                                    ))}
                                </div>

                                <p className="text-[10px] md:text-xs font-bold text-slate-300 tracking-wide mb-6 relative z-10 text-center">
                                    Fund the treasury and earn a strict <span className="text-[#D4AF37] font-black text-sm md:text-base">{formattedLpPercent}%</span> house edge on every ticket sold.
                                </p>

                                <div className="w-full max-w-[300px] md:max-w-sm relative z-10">
                                    <div className="flex flex-col gap-3 md:gap-4">
                                        <div className={`relative flex items-center bg-[#111] border rounded-xl md:rounded-2xl px-4 py-2.5 md:py-3 transition-colors shadow-inner ${exceedsCapacity ? 'border-red-500/50' : 'border-white/10 focus-within:border-[#D4AF37]/50'}`}>
                                            <span className="text-[#D4AF37] font-black mr-2 text-base md:text-lg">$</span>
                                            <input
                                                type="number" min="1" max={remainingCapacityDisplay} placeholder={isPoolFull ? "Pool Full" : "0.00"}
                                                value={depositAmount} onChange={(e) => setDepositAmount(e.target.value ? Number(e.target.value) : '')}
                                                disabled={isPoolFull || txState === 'loading'}
                                                className="w-full bg-transparent text-white text-lg md:text-xl font-black focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50 disabled:cursor-not-allowed pr-16"
                                            />
                                            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                                                {!isPoolFull && (
                                                    <button onClick={() => setDepositAmount(remainingCapacityDisplay)} className="text-[9px] md:text-[10px] font-black text-[#D4AF37] hover:text-white transition-colors bg-[#D4AF37]/10 hover:bg-[#D4AF37]/20 border border-[#D4AF37]/30 px-2 py-1 rounded shadow-sm">MAX</button>
                                                )}
                                            </div>
                                        </div>
                                        {exceedsCapacity && <p className="text-[10px] text-red-400 font-bold text-center mt-[-8px]">Max deposit available: ${remainingCapacityDisplay.toLocaleString()}</p>}

                                        <button onClick={handleDeposit} disabled={!depositAmount || isPoolFull || exceedsCapacity || isDrawing || txState === 'loading'} className="relative w-full py-3.5 md:py-4 overflow-hidden group rounded-xl md:rounded-2xl transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 shadow-[0_0_20px_rgba(212,175,55,0.25)] disabled:shadow-none">
                                            <div className={`absolute inset-0 bg-gradient-to-r from-[#B8860B] via-[#FFD700] to-[#B8860B] bg-[length:200%_100%] ${!isPoolFull && !exceedsCapacity ? 'animate-[gradient_2s_linear_infinite]' : ''}`} />
                                            <span className="relative z-10 text-[10px] md:text-[11px] font-black tracking-[0.25em] text-black uppercase">{isPoolFull ? 'POOL FULL' : exceedsCapacity ? 'EXCEEDS CAPACITY' : 'DEPOSIT FUNDS'}</span>
                                        </button>
                                        <BalanceDisplay balance={balance} />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* --- THE 3-STATE POSITION SECTION (FULLY ABSTRACTED TO USDC) --- */}
                        <div className="w-full">
                            <h3 className="text-[10px] md:text-xs font-black tracking-[0.15em] text-slate-400 uppercase mb-2 md:mb-3 px-1">Your Position</h3>

                            {!lpInfo ? (
                                <div className="bg-[#111]/50 border border-white/5 rounded-xl md:rounded-2xl p-6 text-center">
                                    <p className="text-[11px] md:text-xs font-bold text-white mb-1">No Activity Yet</p>
                                    <p className="text-[8px] md:text-[9px] text-slate-500">Deposit USDC to start earning yield.</p>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-4">

                                    {/* STATE 1: ACTIVE EARNING */}
                                    <div className="bg-[#111] border border-white/10 rounded-xl md:rounded-2xl p-5 md:p-6 shadow-inner">
                                        <div className="flex justify-between items-center mb-2">
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <p className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Vault Position</p>
                                                    <span className="px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[8px] font-black uppercase tracking-widest">Earning Yield</span>
                                                </div>
                                                <p className="text-xl md:text-2xl font-black text-white">
                                                    ~ ${activeUsdcEstimate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                {lpInfo.lastDepositAmount > 0 && (
                                                    <p className="text-[8px] md:text-[9px] text-[#D4AF37] bg-[#D4AF37]/10 px-2 py-1 rounded border border-[#D4AF37]/30">
                                                        + ${(lpInfo.lastDepositAmount / 1e6).toLocaleString()} pending deposit
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        {/* WITHDRAWAL SLIDER */}
                                        {activeShares > 0 && !isPendingCurrentEpoch && (
                                            <div className="mt-6 pt-5 border-t border-white/5">
                                                <div className="flex justify-between items-end text-[10px] md:text-xs mb-3 text-slate-300">
                                                    <span className="font-bold">Select amount to withdraw:</span>
                                                    <span className="text-[#D4AF37] font-black">{withdrawPercent}%</span>
                                                </div>
                                                <input
                                                    type="range" min="0" max="100" step="5"
                                                    value={withdrawPercent}
                                                    onChange={(e) => setWithdrawPercent(Number(e.target.value))}
                                                    disabled={txState === 'loading' || isDrawing}
                                                    className="w-full h-2 bg-black rounded-lg appearance-none cursor-pointer accent-[#D4AF37] mb-2"
                                                />
                                                <div className="flex justify-between text-[8px] md:text-[9px] text-slate-500 mb-5 px-1 font-medium">
                                                    <span>0%</span>
                                                    <span>50%</span>
                                                    <span>100%</span>
                                                </div>
                                                <button
                                                    onClick={handleInitiateWithdraw}
                                                    disabled={withdrawPercent === 0 || isDrawing || txState === 'loading'}
                                                    className="w-full py-3 bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30 rounded-xl text-[10px] md:text-[11px] font-black tracking-widest uppercase hover:bg-[#D4AF37]/20 disabled:opacity-30 transition-colors shadow-sm"
                                                >
                                                    {withdrawPercent > 0
                                                        ? `Initiate Withdrawal (~$${withdrawValueUsdcEstimate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
                                                        : 'Initiate Withdrawal'}
                                                </button>
                                                <p className="text-center text-[8px] text-slate-500 mt-3 font-medium px-4">
                                                    *Withdrawals initiated now will be locked until the end of Epoch {current_epoch_id}.
                                                </p>
                                            </div>
                                        )}
                                    </div>

                                    {/* STATE 2: PENDING UNLOCK (CURRENT EPOCH) */}
                                    {isPendingCurrentEpoch && (
                                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl md:rounded-2xl p-5 md:p-6 relative overflow-hidden">
                                            <div className="flex items-center gap-3 mb-2">
                                                <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                                                <p className="text-[9px] md:text-[10px] font-bold text-amber-500/80 uppercase tracking-widest">Locked Pending Epoch End</p>
                                            </div>
                                            <p className="text-xl md:text-2xl font-black text-amber-500">
                                                ~ ${pendingWithdrawalUsdcEstimate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </p>
                                            <p className="text-[10px] md:text-xs mt-3 text-amber-500/70 font-medium leading-relaxed bg-black/20 p-3 rounded-lg border border-amber-500/10">
                                                Your withdrawal request is locked for the duration of <strong className="text-amber-400">Epoch {current_epoch_id}</strong>.
                                                You can claim your finalized USDC as soon as <strong className="text-amber-400">Epoch {current_epoch_id + 1}</strong> begins.
                                            </p>
                                        </div>
                                    )}

                                    {/* STATE 3: READY TO CLAIM (PAST EPOCH) */}
                                    {isReadyToFinalize && (
                                        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl md:rounded-2xl p-5 md:p-6 shadow-[0_0_20px_rgba(16,185,129,0.15)] relative">
                                            <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/20 rounded-bl-[100px] blur-xl pointer-events-none" />
                                            <p className="text-[9px] md:text-[10px] font-bold text-emerald-400 uppercase tracking-widest mb-1 relative z-10">Ready to Claim</p>

                                            {claimableUsdcMicro > 0 ? (
                                                <p className="text-2xl md:text-3xl font-black text-emerald-400 relative z-10 drop-shadow-md">
                                                    ${(claimableUsdcMicro / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </p>
                                            ) : (
                                                <p className="text-xl md:text-2xl font-black text-emerald-400 relative z-10">
                                                    ~ ${(pendingWithdrawalUsdcEstimate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Ready
                                                </p>
                                            )}

                                            <button
                                                onClick={handleFinalizeWithdraw}
                                                disabled={isDrawing || txState === 'loading'}
                                                className="relative z-10 w-full mt-5 py-3.5 bg-emerald-500 text-black rounded-xl text-[10px] md:text-[11px] font-black tracking-widest uppercase hover:bg-emerald-400 transition-colors shadow-lg active:scale-95 disabled:opacity-50 disabled:active:scale-100"
                                            >
                                                Finalize & Claim USDC
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* ACTIVITY LOGS */}
                        <div className="w-full">
                            <h3 className="text-[10px] md:text-xs font-black tracking-[0.15em] text-slate-400 uppercase mb-2 md:mb-3 px-1">Recent Activity</h3>
                            <div className="bg-[#111] border border-white/5 rounded-xl md:rounded-2xl overflow-hidden">
                                {activityLogs.length === 0 ? (
                                    <div className="p-6 text-center text-[10px] text-slate-500 font-bold uppercase">No past transactions found</div>
                                ) : (
                                    <div className="flex flex-col divide-y divide-white/5">
                                        {activityLogs.map((log) => (
                                            <div key={log.id} className="flex items-center justify-between p-4 hover:bg-white/[0.02] transition-colors">
                                                <div className="flex flex-col">
                                                    <span className={`text-[10px] md:text-xs font-black uppercase tracking-widest ${log.action_type === 'DEPOSIT' ? 'text-blue-400' : log.action_type === 'INITIATE_WITHDRAW' ? 'text-amber-400' : 'text-emerald-400'}`}>
                                                        {log.action_type.replace('_', ' ')}
                                                    </span>
                                                    <span className="text-[8px] md:text-[9px] text-slate-500 font-medium">Epoch {log.epoch_id} • {new Date(log.created_at).toLocaleDateString()}</span>
                                                </div>
                                                <div className="text-right flex flex-col items-end">
                                                    <span className="text-sm md:text-base font-black text-white">
                                                        {log.unit === 'SHARES'
                                                            ? `~ $${(Number(log.amount) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                                            : `$${(Number(log.amount) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                    </div>
                )}
            </div>

            {/* HOW IT WORKS MODAL */}
            {isHowItWorksOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in" onClick={() => setIsHowItWorksOpen(false)}>
                    <div className="bg-[#0a0a0a] border border-[#D4AF37]/30 shadow-[0_0_30px_rgba(212,175,55,0.15)] rounded-[1.5rem] md:rounded-[2rem] p-5 md:p-6 max-w-[300px] md:max-w-sm w-full relative" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setIsHowItWorksOpen(false)} className="absolute top-4 right-4 md:top-5 md:right-5 text-slate-500 hover:text-white transition-colors">
                            <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                        <div className="bg-[#111] rounded-xl p-3 md:p-4 mb-4 md:mb-5 border border-white/5 mt-2">
                            <h3 className="text-[11px] md:text-xs font-black text-white mb-1 tracking-wide">Earn Like a Casino.</h3>
                            <p className="text-[10px] md:text-xs font-bold text-slate-300 tracking-wide mb-6 relative z-10 text-center">
                                Fund the treasury and earn a strict <span className="text-[#D4AF37] font-black">{formattedLpPercent}%</span> house edge on every ticket sold.
                            </p>
                        </div>
                        <div className="space-y-4 md:space-y-5 mb-5 md:mb-6">
                            <div className="flex gap-2.5 md:gap-3 items-start">
                                <div className="w-5 h-5 md:w-6 md:h-6 shrink-0 bg-[#D4AF37] rounded-full flex items-center justify-center text-[9px] md:text-[10px] font-black text-black">1</div>
                                <div>
                                    <h4 className="text-[10px] md:text-[11px] font-bold text-white tracking-wide">Deposit funds</h4>
                                    <p className="text-[7px] md:text-[8px] text-slate-400 mt-0.5">Add USDC to boost the treasury. This creates massive, exciting jackpots for players.</p>
                                </div>
                            </div>
                            <div className="flex gap-2.5 md:gap-3 items-start">
                                <div className="w-5 h-5 md:w-6 md:h-6 shrink-0 bg-[#111] border border-white/10 rounded-full flex items-center justify-center text-[9px] md:text-[10px] font-black text-slate-400">2</div>
                                <div>
                                    <h4 className="text-[10px] md:text-[11px] font-bold text-white tracking-wide">Earn fees instantly</h4>
                                    <p className="text-[7px] md:text-[8px] text-slate-400 mt-0.5">A growing jackpot drives ticket sales. You earn a proportional slice of the {formattedLpPercent}% edge generated.</p>
                                </div>
                            </div>
                            <div className="flex gap-2.5 md:gap-3 items-start">
                                <div className="w-5 h-5 md:w-6 md:h-6 shrink-0 bg-[#111] border border-white/10 rounded-full flex items-center justify-center text-[9px] md:text-[10px] font-black text-slate-400">3</div>
                                <div>
                                    <h4 className="text-[10px] md:text-[11px] font-bold text-white tracking-wide">Total Freedom</h4>
                                    <p className="text-[7px] md:text-[8px] text-slate-400 mt-0.5">Capture the house edge with the absolute freedom to withdraw your funds at any time. *(Subject to epoch locks)*</p>
                                </div>
                            </div>
                        </div>
                        <button onClick={() => setIsHowItWorksOpen(false)} className="w-full py-2.5 md:py-3 bg-[#D4AF37] text-black text-[9px] md:text-[10px] font-black tracking-[0.2em] rounded-xl hover:bg-[#FFD700] transition-colors uppercase active:scale-95">Understood</button>
                    </div>
                </div>
            )}
        </div>
    );
};