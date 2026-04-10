import { useWallet } from '@solana/wallet-adapter-react';

export const MyTickets = () => {
    const { connected } = useWallet();

    // Mock Data
    const mockTickets = [
        { id: "Tk1...", numbers: [7, 14, 21, 33, 42], bonus: 9, status: 'active', winAmount: 0 },
        { id: "Tk2...", numbers: [1, 2, 3, 4, 5], bonus: 10, status: 'winner', winAmount: 5000 },
    ];

    if (!connected) return <div className="text-center py-20 text-slate-400">Please connect your wallet to view your vault.</div>;

    return (
        <div>
            <h2 className="text-3xl font-bold mb-8">My Vault</h2>
            <div className="grid gap-4">
                {mockTickets.map((t, i) => (
                    <div key={i} className={`p-6 rounded-xl border flex items-center justify-between ${t.status === 'winner' ? 'bg-purple-900/20 border-purple-500/50' : 'bg-slate-900 border-white/5'}`}>
                        <div>
                            <p className="text-xs text-slate-500 mb-2 font-mono">ID: {t.id}</p>
                            <div className="flex gap-2">
                                {t.numbers.map((n, idx) => <span key={idx} className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-sm font-bold">{n}</span>)}
                                <span className="w-8 h-8 rounded-full bg-amber-500/20 text-amber-500 border border-amber-500/50 flex items-center justify-center text-sm font-bold ml-2">{t.bonus}</span>
                            </div>
                        </div>

                        {t.status === 'winner' ? (
                            <button className="px-6 py-3 bg-green-500 hover:bg-green-400 text-white rounded-lg font-bold shadow-[0_0_20px_rgba(34,197,94,0.4)] transition-all">
                                Claim ${t.winAmount}
                            </button>
                        ) : (
                            <span className="px-4 py-2 bg-slate-800 text-slate-400 rounded-lg text-sm font-semibold">Awaiting Draw</span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};