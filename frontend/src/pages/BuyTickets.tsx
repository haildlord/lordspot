import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

export const BuyTickets = () => {
    const { connected } = useWallet();
    const [normals, setNormals] = useState<number[]>([7, 14, 21, 33, 42]);
    const [bonus, setBonus] = useState(9);
    const [isBuying, setIsBuying] = useState(false);

    const handleBuy = async () => { /* your existing logic */ };

    return (
        <div className="max-w-3xl mx-auto">
            <div className="glass border border-white/10 rounded-3xl p-10 shadow-2xl">
                <h2 className="text-5xl font-black mb-2 text-center">BUILD YOUR TICKET</h2>
                <p className="text-slate-400 text-center mb-12">Pick 5 numbers • 1 Lord Ball</p>

                {/* Normal numbers */}
                <div className="mb-12">
                    <p className="text-amber-300 text-sm font-bold mb-4 tracking-widest">YOUR NUMBERS</p>
                    <div className="flex gap-4 justify-center flex-wrap">
                        {normals.map((num, i) => (
                            <div key={i} className="lottery-ball w-20 h-20 rounded-2xl bg-slate-900 border-4 border-purple-400 flex items-center justify-center text-4xl font-black shadow-inner">
                                {num}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Lord Ball */}
                <div className="mb-12 text-center">
                    <p className="text-amber-300 text-sm font-bold mb-4 tracking-widest">LORD BALL</p>
                    <div className="inline-flex items-center justify-center w-28 h-28 rounded-3xl bg-gradient-to-br from-amber-400 to-yellow-500 text-slate-950 text-6xl font-black shadow-[0_0_60px_-10px] shadow-amber-400">
                        {bonus}
                    </div>
                </div>

                <button
                    onClick={handleBuy}
                    disabled={isBuying || !connected}
                    className="w-full py-8 text-2xl font-black bg-gradient-to-r from-purple-600 to-amber-500 hover:from-purple-500 hover:to-amber-400 disabled:opacity-50 rounded-3xl transition-all shadow-xl"
                >
                    {isBuying ? "MINTING ON SOLANA..." : connected ? "MINT TICKET • 5 USDC" : "CONNECT WALLET TO PLAY"}
                </button>
            </div>
        </div>
    );
};