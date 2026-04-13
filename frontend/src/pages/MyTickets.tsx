import { useWallet } from '@solana/wallet-adapter-react';

export const MyTickets = () => {
    const { connected } = useWallet();

    const mockTickets = [
        { id: "Tk1...", numbers: [7,14,21,33,42], bonus: 9, status: 'active', winAmount: 0 },
        { id: "Tk2...", numbers: [1,2,3,4,5], bonus: 10, status: 'winner', winAmount: 12400 },
    ];

    if (!connected) {
        return (
            <div className="text-center py-20 md:py-32 px-4">
                <p className="text-2xl md:text-3xl text-slate-400">Connect your wallet to open your vault</p>
            </div>
        );
    }

    return (
        <div className="px-2 sm:px-0">
            <h2 className="text-4xl md:text-5xl font-black mb-8 md:mb-10 text-center md:text-left">MY VAULT</h2>
            <div className="space-y-6">
                {mockTickets.map((ticket, i) => (
                    <div
                        key={i}
                        className={`glass rounded-2xl md:rounded-3xl p-6 md:p-8 flex flex-col lg:flex-row items-center lg:items-center justify-between gap-6 lg:gap-0 border ${ticket.status === 'winner' ? 'border-amber-400/60' : 'border-white/10'}`}
                    >
                        <div className="flex flex-col sm:flex-row items-center gap-4 md:gap-8 w-full lg:w-auto text-center sm:text-left">
                            <div className="font-mono text-sm text-slate-400">#{ticket.id}</div>
                            <div className="flex flex-wrap justify-center sm:justify-start gap-2 md:gap-3">
                                {ticket.numbers.map((n, idx) => (
                                    <div key={idx} className="w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-slate-800 flex items-center justify-center text-base md:text-lg font-bold border border-purple-300/30">
                                        {n}
                                    </div>
                                ))}
                                <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-gradient-to-br from-amber-400 to-yellow-500 flex items-center justify-center text-base md:text-lg font-black text-slate-950">
                                    {ticket.bonus}
                                </div>
                            </div>
                        </div>

                        <div className="w-full lg:w-auto flex justify-center">
                            {ticket.status === 'winner' ? (
                                <button className="w-full sm:w-auto px-8 md:px-10 py-3 md:py-4 bg-green-500 hover:bg-green-400 rounded-xl md:rounded-2xl font-bold text-base md:text-lg shadow-lg shadow-green-500/50">
                                    CLAIM ${ticket.winAmount.toLocaleString()}
                                </button>
                            ) : (
                                <div className="w-full sm:w-auto px-6 md:px-8 py-3 md:py-4 bg-slate-800 text-slate-400 rounded-xl md:rounded-2xl font-semibold text-center">
                                    AWAITING DRAW
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};