import { useWallet } from '@solana/wallet-adapter-react';

export const MyTickets = () => {
    const { connected } = useWallet();

    const mockTickets = [
        { id: "Tk1A8f9", numbers: [7,14,21,33,42], bonus: 9, status: 'active', winAmount: 0 },
        { id: "Tk2Xb4", numbers: [1,2,3,4,5], bonus: 10, status: 'winner', winAmount: 12400 },
    ];

    if (!connected) {
        return (
            <div className="min-h-[calc(100vh-80px)] flex items-center justify-center px-4">
                <p className="text-xl text-slate-500 tracking-widest uppercase font-semibold">Connect wallet to view your vault</p>
            </div>
        );
    }

    return (
        <div className="relative min-h-[calc(100vh-80px)] pt-12 pb-24 px-4 sm:px-6">
            <div className="absolute top-0 inset-x-0 h-full bg-[radial-gradient(ellipse_at_top_left,rgba(16,185,129,0.06)_0%,transparent_60%)] pointer-events-none" />

            <div className="relative z-10 max-w-5xl mx-auto">
                <div className="flex items-center justify-between mb-12">
                    <div>
                        <h2 className="text-4xl font-black tracking-tight mb-2">MY VAULT</h2>
                        <p className="text-slate-400">Your on-chain lottery entries</p>
                    </div>
                    <div className="text-right">
                        <p className="text-xs font-bold tracking-widest text-slate-400">TOTAL VALUE</p>
                        <p className="text-4xl font-black text-[#D4AF37]">$12,400</p>
                    </div>
                </div>

                <div className="space-y-6">
                    {mockTickets.map((ticket, i) => (
                        <div
                            key={i}
                            className={`premium-glass rounded-3xl p-8 flex flex-col lg:flex-row items-center justify-between gap-8 transition-all hover:scale-[1.02] ${
                                ticket.status === 'winner' ? 'border-l-4 border-l-emerald-500 bg-white/[0.03]' : ''
                            }`}
                        >
                            <div className="flex flex-col sm:flex-row items-center gap-8">
                                <div>
                                    <p className="text-xs tracking-[0.1em] text-slate-400 mb-1">TICKET ID</p>
                                    <p className="font-mono text-xl">{ticket.id}</p>
                                </div>

                                <div className="flex gap-3">
                                    {ticket.numbers.map((n, idx) => (
                                        <div key={idx} className="w-11 h-11 rounded-2xl bg-black/40 flex items-center justify-center text-lg font-bold">
                                            {n}
                                        </div>
                                    ))}
                                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#D4AF37] to-amber-600 flex items-center justify-center text-lg font-black text-black">
                                        {ticket.bonus}
                                    </div>
                                </div>
                            </div>

                            <div>
                                {ticket.status === 'winner' ? (
                                    <button className="px-10 py-4 bg-emerald-500 hover:bg-emerald-600 text-black font-black rounded-2xl text-lg transition-all">
                                        CLAIM ${ticket.winAmount.toLocaleString()}
                                    </button>
                                ) : (
                                    <div className="px-8 py-4 bg-white/5 border border-white/10 rounded-2xl text-sm font-semibold tracking-widest text-slate-400">
                                        AWAITING DRAW
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};