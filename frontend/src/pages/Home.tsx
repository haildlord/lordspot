export const Home = () => {
    const currentPrize = "2,847,650";

    return (
        <div className="flex flex-col items-center justify-center text-center pt-12">
            {/* Live Badge */}
            <div className="inline-flex items-center gap-2 px-6 py-2.5 rounded-3xl border border-amber-400/30 bg-amber-400/10 text-amber-300 text-sm font-bold tracking-[2px] mb-8">
                <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
                LIVE DRAWING • 4H 12M LEFT
            </div>

            {/* Jackpot */}
            <div className="mb-6">
                <p className="text-amber-300 text-xl font-medium tracking-widest mb-2">CURRENT JACKPOT</p>
                <h1 className="text-8xl md:text-[9rem] font-black tracking-tighter jackpot-glow">
                    $<span className="bg-clip-text text-transparent bg-gradient-to-b from-amber-300 via-white to-amber-400">{currentPrize}</span>
                </h1>
            </div>

            <p className="text-2xl text-slate-400 max-w-2xl mb-16">
                5 numbers + 1 Lord Ball.<br />
                <span className="text-purple-400">One winner takes it all on Solana.</span>
            </p>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-8 max-w-2xl w-full mb-16">
                <div className="text-center">
                    <p className="text-slate-500 text-sm">TICKET PRICE</p>
                    <p className="text-4xl font-bold text-white">5 USDC</p>
                </div>
                <div className="text-center">
                    <p className="text-slate-500 text-sm">TICKETS SOLD</p>
                    <p className="text-4xl font-bold text-white">87,420</p>
                </div>
                <div className="text-center">
                    <p className="text-slate-500 text-sm">NEXT DRAW</p>
                    <p className="text-4xl font-bold text-amber-400">04:12:59</p>
                </div>
            </div>

            <a
                href="/buy"
                className="px-16 py-7 bg-gradient-to-r from-purple-600 to-amber-500 hover:from-purple-500 hover:to-amber-400 text-2xl font-black rounded-3xl shadow-2xl shadow-purple-500/50 hover:scale-105 transition-all active:scale-95"
            >
                CLAIM YOUR TICKET NOW →
            </a>
        </div>
    );
};