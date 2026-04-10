import { useWallet } from '@solana/wallet-adapter-react';

export const MyTickets = () => {
    const { connected } = useWallet();

    const mockTickets = [
        { id: "Tk1...", numbers: [7,14,21,33,42], bonus: 9, status: 'active', winAmount: 0 },
        { id: "Tk2...", numbers: [1,2,3,4,5], bonus: 10, status: 'winner', winAmount: 12400 },
    ];

    if (!connected) {
        return (
            <div className="text-center py-32">
                <p className="text-3xl text-slate-400">Connect your wallet to open your vault</p>
            </div>
        );
    }

    return (
        <div>
            <h2 className="text-5xl font-black mb-10">MY VAULT</h2>
            <div className="space-y-6">
                {mockTickets.map((ticket, i) => (
                    <div
                        key={i}
                        className={`glass rounded-3xl p-8 flex items-center justify-between border ${ticket.status === 'winner' ? 'border-amber-400/60' : 'border-white/10'}`}
                    >
                        <div className="flex items-center gap-8">
                            <div className="font-mono text-sm text-slate-400">#{ticket.id}</div>
                            <div className="flex gap-3">
                                {ticket.numbers.map((n, idx) => (
                                    <div key={idx} className="w-10 h-10 rounded-2xl bg-slate-800 flex items-center justify-center text-lg font-bold border border-purple-300/30">
                                        {n}
                                    </div>
                                ))}
                                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-yellow-500 flex items-center justify-center text-lg font-black text-slate-950">
                                    {ticket.bonus}
                                </div>
                            </div>
                        </div>

                        {ticket.status === 'winner' ? (
                            <button className="px-10 py-4 bg-green-500 hover:bg-green-400 rounded-2xl font-bold text-lg shadow-lg shadow-green-500/50">
                                CLAIM ${ticket.winAmount.toLocaleString()}
                            </button>
                        ) : (
                            <div className="px-8 py-4 bg-slate-800 text-slate-400 rounded-2xl font-semibold">AWAITING DRAW</div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};