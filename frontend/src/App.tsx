import { useMemo } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import '@solana/wallet-adapter-react-ui/styles.css';
import { Faucet } from './pages/Faucet';
import { Toaster } from 'react-hot-toast';

import { Home } from './pages/Home';
import { BuyTickets } from './pages/BuyTickets';
import { MyTickets } from './pages/MyTickets';

export const App = () => {
    const endpoint = useMemo(() => clusterApiUrl('devnet'), []);
    const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

    return (
        <ConnectionProvider endpoint={endpoint}>
            <WalletProvider wallets={wallets} autoConnect>
                <WalletModalProvider>
                    <Router>
                        <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-black text-white font-sans overflow-x-hidden">
                            {/* Premium Navbar */}
                            <nav className="glass border-b border-white/10 sticky top-0 z-50">
                                <div className="max-w-7xl mx-auto px-6 py-5 flex justify-between items-center">
                                    <div className="flex items-center gap-10">
                                        {/* Logo */}
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 bg-gradient-to-br from-purple-500 to-amber-400 rounded-2xl flex items-center justify-center text-2xl shadow-lg shadow-purple-500/50">
                                                👑
                                            </div>
                                            <h1 className="text-3xl font-black tracking-tighter neon-purple">
                                                LORDSPOT
                                            </h1>
                                        </div>

                                        <NavLinks />
                                    </div>

                                    <WalletMultiButton className="!bg-gradient-to-r !from-purple-600 !to-amber-500 hover:!from-purple-500 hover:!to-amber-400 !font-bold !px-6 !py-2.5 !rounded-2xl !transition-all !shadow-lg !shadow-purple-500/30" />
                                </div>
                            </nav>

                            {/* Main Content */}
                            <Toaster position="bottom-right" reverseOrder={false} />
                            <main className="max-w-7xl mx-auto px-6 pt-8 pb-20">
                                <Routes>
                                    <Route path="/" element={<Home />} />
                                    <Route path="/buy" element={<BuyTickets />} />
                                    <Route path="/faucet" element={<Faucet />} />
                                    <Route path="/my-tickets" element={<MyTickets />} />

                                </Routes>
                            </main>

                            {/* Footer glow line */}
                            <div className="h-px bg-gradient-to-r from-transparent via-purple-500/30 to-transparent" />
                        </div>
                    </Router>
                </WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
};

const NavLinks = () => {
    const location = useLocation();
    const links = [
        { path: '/', label: 'GRAND PRIZE' },
        { path: '/buy', label: 'PLAY NOW' },
        { path: '/faucet', label: 'FAUCET' },
        { path: '/my-tickets', label: 'MY VAULT' }
    ];

    return (
        <div className="hidden md:flex gap-8 text-sm font-semibold tracking-widest">
            {links.map((link) => (
                <Link
                    key={link.path}
                    to={link.path}
                    className={`hover:text-amber-400 transition-all duration-300 relative ${location.pathname === link.path ? 'text-amber-400' : 'text-slate-300'}`}
                >
                    {link.label}
                    {location.pathname === link.path && (
                        <div className="absolute -bottom-1 left-0 w-full h-0.5 bg-gradient-to-r from-purple-500 to-amber-400 rounded-full" />
                    )}
                </Link>
            ))}
        </div>
    );
};