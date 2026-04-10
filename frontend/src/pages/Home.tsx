import { Link } from 'react-router-dom';

export const Home = () => {
    // Mock data - replace with your Anchor program fetch later
    const currentPrize = "1,250,000";

    return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="inline-block px-4 py-1.5 rounded-full border border-purple-500/30 bg-purple-500/10 text-purple-300 text-sm font-semibold tracking-wide mb-8 animate-pulse">
                🟢 LIVE DRAWING IN PROGRESS
            </div>

            <h2 className="text-6xl md:text-8xl font-black text-white mb-4 tracking-tighter">
                $<span className="bg-gradient-to-b from-white to-slate-400 bg-clip-text text-transparent">{currentPrize}</span>
            </h2>
            <p className="text-xl text-slate-400 mb-12 max-w-lg">
                The ultimate on-chain lottery. 5 Numbers. 1 Lord Ball. Win the USDC Megapot.
            </p>

            <div className="grid grid-cols-3 gap-6 mb-12 text-left">
                <StatCard label="Ticket Price" value="5 USDC" />
                <StatCard label="Tickets Sold" value="42,105" />
                <StatCard label="Time Left" value="04:12:59" />
            </div>

            <Link
                to="/buy"
                className="px-10 py-5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl font-bold text-lg shadow-[0_0_40px_rgba(147,51,234,0.4)] hover:shadow-[0_0_60px_rgba(147,51,234,0.6)] transition-all hover:-translate-y-1"
            >
                Get Your Tickets Now
            </Link>
        </div>
    );
};

const StatCard = ({ label, value }: { label: string, value: string }) => (
    <div className="bg-slate-900/50 border border-white/5 rounded-xl p-6 backdrop-blur-sm">
        <p className="text-slate-500 text-sm font-medium mb-1 uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold text-white">{value}</p>
    </div>
);