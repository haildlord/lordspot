import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

export const BuyTickets = () => {
    const { connected } = useWallet();
    const [normals] = useState<number[]>([7, 14, 21, 33, 42]);
    const [bonus] = useState(9);
    const [isBuying, setIsBuying] = useState(false);

    const handleBuy = async () => {
        if (!connected) return;
        setIsBuying(true);
        // Your existing buy logic here
        setTimeout(() => setIsBuying(false), 1800); // demo
    };

    return (
        <div className="relative min-h-[calc(100vh-80px)] pt-12 pb-24 px-4 sm:px-6 overflow-hidden">
            {/* Page-specific subtle glow */}
            <div className="absolute top-0 inset-x-0 h-full bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.06)_0%,transparent_65%)] pointer-events-none" />

            <div className="relative z-10 max-w-3xl mx-auto">
                <div className="text-center mb-12">
                    <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4 text-glow-purple">MINT ENTRY</h2>
                    <p className="text-slate-400 font-medium tracking-wide">Secure your position on the ledger.</p>
                </div>

                <div className="premium-glass rounded-[2.5rem] p-10 md:p-16 border border-white/5">
                    {/* Standard Picks */}
                    <div className="mb-14">
                        <div className="flex items-center gap-4 mb-8">
                            <div className="h-px bg-white/10 flex-1" />
                            <p className="text-slate-400 text-xs font-bold tracking-[0.25em]">STANDARD PICKS</p>
                            <div className="h-px bg-white/10 flex-1" />
                        </div>

                        <div className="flex gap-4 sm:gap-6 justify-center flex-wrap">
                            {normals.map((num, i) => (
                                <div
                                    key={i}
                                    className="ticket-ball premium-ball w-16 h-16 sm:w-20 sm:h-20 rounded-3xl border border-white/10 flex items-center justify-center text-3xl font-black text-white"
                                >
                                    {num}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Lord Ball */}
                    <div className="mb-16">
                        <div className="flex items-center gap-4 mb-8">
                            <div className="h-px bg-white/10 flex-1" />
                            <p className="text-[#D4AF37] text-xs font-bold tracking-[0.25em]">LORD BALL</p>
                            <div className="h-px bg-white/10 flex-1" />
                        </div>

                        <div className="flex justify-center">
                            <div className="w-28 h-28 md:w-36 md:h-36 rounded-3xl bg-gradient-to-br from-[#FFD700] to-[#B8860B] text-black flex items-center justify-center text-5xl md:text-6xl font-black shadow-[0_0_50px_rgba(212,175,55,0.5)] ring-4 ring-[#FFD700]/30">
                                {bonus}
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={handleBuy}
                        disabled={isBuying || !connected}
                        className="premium-button w-full py-7 text-lg font-black tracking-[0.15em] bg-white text-black hover:bg-[#D4AF37] disabled:opacity-40 rounded-3xl transition-all shadow-xl"
                    >
                        {isBuying ? "CONFIRMING ON-CHAIN..." : connected ? "PAY 5 USDC • MINT ENTRY" : "CONNECT WALLET TO ENTER"}
                    </button>
                </div>
            </div>
        </div>
    );
};