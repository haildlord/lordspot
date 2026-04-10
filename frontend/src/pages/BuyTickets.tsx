import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

export const BuyTickets = () => {
    const { connected } = useWallet();
    const [normals, setNormals] = useState<number[]>([7, 14, 21, 33, 42]);
    const [bonus, setBonus] = useState<number>(9);
    const [isBuying, setIsBuying] = useState(false);

    const handleBuy = async () => {
        if (!connected) return alert("Connect wallet first!");
        setIsBuying(true);
        try {
            // TODO: Call your Solana Anchor Program here
            // await program.methods.buyTickets(normals, bonus).accounts({...}).rpc();
            console.log("Buying ticket with:", normals, "Lord Ball:", bonus);
            setTimeout(() => {
                alert("Ticket Minted Successfully! 🎫");
                setIsBuying(false);
            }, 1500);
        } catch (e) {
            console.error(e);
            setIsBuying(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto mt-10">
            <div className="bg-slate-900 border border-white/10 rounded-2xl p-8 shadow-2xl">
                <h2 className="text-3xl font-bold mb-2">Build Your Ticket</h2>
                <p className="text-slate-400 mb-8">Pick 5 numbers (1-69) and 1 Lord Ball (1-26).</p>

                <div className="flex gap-4 justify-center mb-10">
                    {normals.map((num, i) => (
                        <div key={i} className="w-16 h-16 rounded-full bg-slate-800 border-2 border-slate-700 flex items-center justify-center text-2xl font-bold text-white shadow-inner">
                            {num}
                        </div>
                    ))}
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-yellow-400 to-amber-600 border-2 border-yellow-300 flex items-center justify-center text-2xl font-black text-slate-900 shadow-[0_0_20px_rgba(251,191,36,0.4)] ml-4 relative">
                        <span className="absolute -top-6 text-xs font-bold text-yellow-500 uppercase tracking-widest">Lord</span>
                        {bonus}
                    </div>
                </div>

                <button
                    onClick={handleBuy}
                    disabled={isBuying || !connected}
                    className="w-full py-4 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-xl font-bold text-lg transition-colors flex justify-center items-center gap-2"
                >
                    {isBuying ? "Confirming on Solana..." : connected ? "Mint Ticket - 5 USDC" : "Connect Wallet to Play"}
                </button>
            </div>
        </div>
    );
};