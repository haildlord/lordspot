import { useMemo } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import '@solana/wallet-adapter-react-ui/styles.css';

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
                        <div className="min-h-screen bg-slate-950 text-white font-sans selection:bg-purple-500/30">
                            {/* Navigation Bar */}
                            <nav className="border-b border-white/10 bg-slate-950/50 backdrop-blur-md sticky top-0 z-50">
                                <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
                                    <div className="flex items-center gap-8">
                                        <h1 className="text-2xl font-black bg-gradient-to-r from-purple-400 to-indigo-500 bg-clip-text text-transparent tracking-tighter">
                                            LORDSPOT
                                        </h1>
                                        <NavLinks />
                                    </div>
                                    <WalletMultiButton className="!bg-purple-600 hover:!bg-purple-700 !transition-colors !rounded-lg" />
                                </div>
                            </nav>

                            {/* Page Content */}
                            <main className="max-w-6xl mx-auto px-4 py-8">
                                <Routes>
                                    <Route path="/" element={<Home />} />
                                    <Route path="/buy" element={<BuyTickets />} />
                                    <Route path="/my-tickets" element={<MyTickets />} />
                                </Routes>
                            </main>
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
        { path: '/', label: 'Grand Prize' },
        { path: '/buy', label: 'Play Now' },
        { path: '/my-tickets', label: 'My Vault' }
    ];

    return (
        <div className="hidden md:flex gap-6 font-medium text-sm text-slate-300">
            {links.map((link) => (
                <Link
                    key={link.path}
                    to={link.path}
                    className={`hover:text-white transition-colors ${location.pathname === link.path ? 'text-purple-400 drop-shadow-[0_0_8px_rgba(168,85,247,0.5)]' : ''}`}
                >
                    {link.label}
                </Link>
            ))}
        </div>
    );
};