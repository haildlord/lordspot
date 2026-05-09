import { useState, useRef, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAppData } from '../context/AppDataContext';

export const RunLordsPotButton = () => {
    // We only need the wallet to ensure they are connected to click the button.
    const { connected } = useWallet();
    const { refreshVaultData, next_draw_at, devnet_protocol_programid,  switchboard_random_account, devnet_swtichboard_programid, devnet_swtichboard_queue, isDrawing} = useAppData();

    const render_post_server_link = import.meta.env.VITE_RENDER_POST_SERVER_LINK;

    // UI States
    const [crankState, setCrankState] = useState<string>('idle');
    const [errorMessage, setErrorMessage] = useState<string>('');
    const isCranking = useRef(false);

    // ====================================================================
    // TIME LOCK LOGIC (Remains exactly the same!)
    // ====================================================================
    const [isDrawTimeReached, setIsDrawTimeReached] = useState(false);
    const [timeRemainingStr, setTimeRemainingStr] = useState('');

    useEffect(() => {
        if (!next_draw_at) return;

        const checkTime = () => {
            const drawTimeMs = new Date(next_draw_at).getTime();
            const nowMs = Date.now();
            const diff = drawTimeMs - nowMs;

            if (diff <= 0) {
                setIsDrawTimeReached(true);
                setTimeRemainingStr('');
            } else {
                setIsDrawTimeReached(false);
                // Format the remaining time for the locked button
                const hours = Math.floor(diff / (1000 * 60 * 60)).toString().padStart(2, '0');
                const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)).toString().padStart(2, '0');
                const secs = Math.floor((diff % (1000 * 60)) / 1000).toString().padStart(2, '0');
                setTimeRemainingStr(`${hours}:${mins}:${secs}`);
            }
        };

        checkTime(); // Run immediately
        const interval = setInterval(checkTime, 1000); // Check every second
        return () => clearInterval(interval);
    }, [next_draw_at]);

    // ====================================================================
    // NEW RELAYER CRANK HANDLER
    // ====================================================================
    const handleRunLordsPot = async () => {
        if (isCranking.current || !connected || !isDrawTimeReached) return;

        isCranking.current = true;
        setErrorMessage('');

        // We set it straight to running, as the backend handles the 3 phases securely
        setCrankState('running');

        try {
            // Send the request to your secure backend API via Vite proxy
            const response = await fetch(`${render_post_server_link}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    programId: devnet_protocol_programid,
                    sbProgramId: devnet_swtichboard_programid,
                    sbQueuePubkey: devnet_swtichboard_queue,
                    sbRandomAccount: switchboard_random_account
                })
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.error || "Backend Relayer Failed");
            }

            console.log("Success! LordsPot Run Complete. Sig:", data.txSignature);

            setCrankState('success');
            refreshVaultData();

            setTimeout(() => {
                setCrankState('idle');
                isCranking.current = false;
            }, 4000);

        } catch (error: any) {
            console.error("Crank Failed:", error);
            setErrorMessage(error.message || "Transaction failed");
            setCrankState('error');
            setTimeout(() => {
                setCrankState('idle');
                isCranking.current = false;
            }, 3001);
        }
    };

    return (
        <div className="w-full flex flex-col items-center">

            {/* OVERLAY LOADER */}
            {crankState !== 'idle' && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in">
                    <div className="w-64 h-64 bg-gradient-to-b from-[#1a1a1a] to-[#0d0d0d] border border-[#D4AF37]/30 rounded-[2rem] shadow-[0_0_40px_rgba(212,175,55,0.15)] flex flex-col items-center justify-center relative overflow-hidden text-center p-4">

                        {crankState === 'running' && (
                            <>
                                <div className="relative flex items-center justify-center mb-5">
                                    <div className="absolute w-16 h-16 border-4 border-[#D4AF37]/10 border-t-[#D4AF37] rounded-full animate-spin" />
                                    <div className="w-6 h-6 bg-[#D4AF37] rounded-full animate-pulse shadow-[0_0_15px_rgba(212,175,55,0.6)]" />
                                </div>
                                <h3 className="text-[#D4AF37] font-black tracking-[0.1em] mb-1">
                                    EXECUTING
                                </h3>
                                <p className="text-slate-400 text-[10px] font-bold tracking-widest uppercase">
                                    Contacting Secure Relayer...
                                </p>
                                <p className="text-[#D4AF37]/80 text-[8px] mt-4 uppercase tracking-widest font-bold">Please wait ~10 seconds</p>
                            </>
                        )}

                        {crankState === 'success' && (
                            <div className="flex flex-col items-center animate-[scale-in_0.4s_cubic-bezier(0.175,0.885,0.32,1.275)]">
                                <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mb-3 border border-green-500/30">
                                    <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                </div>
                                <p className="text-green-400 font-black tracking-[0.1em] text-sm drop-shadow-md">EPOCH FINALIZED</p>
                            </div>
                        )}

                        {crankState === 'error' && (
                            <div className="flex flex-col items-center animate-[scale-in_0.4s_cubic-bezier(0.175,0.885,0.32,1.275)]">
                                <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-3 border border-red-500/30">
                                    <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                </div>
                                <p className="text-red-400 font-black tracking-[0.1em] text-sm drop-shadow-md mb-2">CRANK FAILED</p>
                                <p className="text-[8px] text-slate-400 break-words max-w-full px-2">{errorMessage.substring(0, 60)}...</p>
                            </div>
                        )}

                    </div>
                </div>
            )}

            {/* BUTTON ITSELF WITH TIMELOCK */}
            <button
                onClick={handleRunLordsPot}
                disabled={!connected || crankState !== 'idle'} // ! add isDrawing & !isDrawTimeReached
                className={`relative w-full py-4 overflow-hidden group rounded-2xl transition-all shadow-[0_0_20px_rgba(212,175,55,0.15)] active:scale-95 z-20 ${!isDrawTimeReached ? 'max-w-[280px] opacity-60 cursor-not-allowed' : 'max-w-[200px] hover:opacity-100 disabled:opacity-50 disabled:cursor-not-allowed'}`}
            >
                <div className={`absolute inset-0 bg-gradient-to-r from-[#B8860B] via-[#FFD700] to-[#B8860B] bg-[length:200%_100%] ${isDrawTimeReached ? 'animate-[gradient_2s_linear_infinite]' : ''}`} />
                <div className="absolute inset-[2px] bg-[#0a0a0a] rounded-[14px] group-hover:bg-transparent transition-colors duration-300 z-0" />
                <span className="relative z-10 flex items-center justify-center gap-2 text-xs md:text-sm font-black tracking-[0.2em] text-[#D4AF37] group-hover:text-black transition-colors duration-300">
                    {!isDrawTimeReached ? (
                        <>
                            <svg className="w-4 h-4 text-slate-400 group-hover:text-[#333] transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                            {timeRemainingStr}
                        </>
                    ) : (
                        <>
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                            RUN LORDSPOT
                        </>
                    )}
                </span>
            </button>

            {!connected && (
                <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mt-3">Connect wallet to crank the network</p>
            )}
        </div>
    );
};
