import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

export const BuyTickets = () => {
    const { connected } = useWallet();
    const [normals, setNormals] = useState<number[]>([7, 14, 21, 33, 42]);
    const [bonus, setBonus] = useState(9);
    const [isBuying, setIsBuying] = useState(false);

    const handleBuy = async () => { /* your existing logic */ };

    return (
        <div className="max-w-3xl mx-auto px-2 sm:px-0">
            <div className="glass border border-white/10 rounded-2xl md:rounded-3xl p-6 md:p-10 shadow-2xl">
                <h2 className="text-3xl md:text-5xl font-black mb-2 text-center">BUILD YOUR TICKET</h2>
                <p className="text-slate-400 text-center mb-8 md:mb-12 text-sm md:text-base">Pick 5 numbers • 1 Lord Ball</p>

                {/* Normal numbers */}
                <div className="mb-10 md:mb-12">
                    <p className="text-amber-300 text-xs md:text-sm font-bold mb-4 tracking-widest text-center">YOUR NUMBERS</p>
                    <div className="flex gap-2 sm:gap-4 justify-center flex-wrap">
                        {normals.map((num, i) => (
                            <div key={i} className="lottery-ball w-12 h-12 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-xl md:rounded-2xl bg-slate-900 border-2 md:border-4 border-purple-400 flex items-center justify-center text-xl sm:text-2xl md:text-4xl font-black shadow-inner">
                                {num}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Lord Ball */}
                <div className="mb-10 md:mb-12 text-center">
                    <p className="text-amber-300 text-xs md:text-sm font-bold mb-4 tracking-widest">LORD BALL</p>
                    <div className="inline-flex items-center justify-center w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 rounded-2xl md:rounded-3xl bg-gradient-to-br from-amber-400 to-yellow-500 text-slate-950 text-4xl sm:text-5xl md:text-6xl font-black shadow-[0_0_40px_-10px] md:shadow-[0_0_60px_-10px] shadow-amber-400">
                        {bonus}
                    </div>
                </div>

                <button
                    onClick={handleBuy}
                    disabled={isBuying || !connected}
                    className="w-full py-5 md:py-8 text-lg sm:text-xl md:text-2xl font-black bg-gradient-to-r from-purple-600 to-amber-500 hover:from-purple-500 hover:to-amber-400 disabled:opacity-50 rounded-2xl md:rounded-3xl transition-all shadow-xl"
                >
                    {isBuying ? "MINTING ON SOLANA..." : connected ? "MINT TICKET • 5 USDC" : "CONNECT WALLET TO PLAY"}
                </button>
            </div>
        </div>
    );
};