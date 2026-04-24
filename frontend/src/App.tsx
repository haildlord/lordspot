import { useMemo, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import '@solana/wallet-adapter-react-ui/styles.css';
import { Toaster } from 'react-hot-toast';

import { Home } from './pages/Home';
import { BuyTickets } from './pages/BuyTickets';
import { Faucet } from './pages/Faucet';
import { MyTickets } from './pages/MyTickets';

export const App = () => {
    const endpoint = useMemo(() => clusterApiUrl('devnet'), []);
    const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    return (
        <ConnectionProvider endpoint={endpoint}>
            <WalletProvider wallets={wallets} autoConnect>
                <WalletModalProvider>
                    <Router>
                        <div className="min-h-screen text-white font-sans relative">
                            {/* Ambient Global Background */}
                            <div className="bg-orb-1" />
                            <div className="bg-orb-2" />

                            {/* Ultra-Premium Glass Navbar */}
                            <nav className="glass-nav sticky top-0 z-50">
                                <div className="max-w-7xl mx-auto px-4 md:px-8 py-4">
                                    <div className="flex justify-between items-center">

                                        {/* Logo & Nav */}
                                        <div className="flex items-center gap-12 shrink-0">
                                            <Link to="/" className="flex items-center gap-3 relative z-50 group">
                                                <h1 className="text-2xl font-black tracking-[0.2em] text-white">
                                                    LORDS<span className="text-[#D4AF37]">POT</span>
                                                </h1>
                                            </Link>

                                            <div className="hidden lg:block">
                                                <NavLinks />
                                            </div>
                                        </div>

                                        {/* Wallet */}
                                        <div className="flex items-center gap-4 relative z-50">
                                            <WalletMultiButton className="!bg-white/5 hover:!bg-white/10 !border !border-white/10 !text-white !font-semibold !text-sm !px-6 !py-3 !rounded-xl !transition-all !whitespace-nowrap shrink-0 !h-auto" />

                                            <button
                                                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                                                className="lg:hidden p-2 text-slate-400 hover:text-white transition-colors"
                                            >
                                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isMobileMenuOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Mobile Menu */}
                                {isMobileMenuOpen && (
                                    <div className="lg:hidden absolute top-full left-0 w-full premium-glass border-t-0 shadow-2xl">
                                        <div className="px-8 py-8">
                                            <NavLinks isMobile closeMenu={() => setIsMobileMenuOpen(false)} />
                                        </div>
                                    </div>
                                )}
                            </nav>

                            <Toaster position="bottom-right" toastOptions={{ style: { background: '#111', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' } }} />

                            <main className="w-full">
                                <Routes>
                                    <Route path="/" element={<Home />} />
                                    <Route path="/buy" element={<BuyTickets />} />
                                    <Route path="/faucet" element={<Faucet />} />
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

const NavLinks = ({ isMobile = false, closeMenu }: { isMobile?: boolean, closeMenu?: () => void }) => {
    const location = useLocation();
    const links = [
        { path: '/', label: 'VAULT' },
        { path: '/buy', label: 'ENTER DRAW' },
        { path: '/faucet', label: 'FAUCET' },
        { path: '/my-tickets', label: 'MY TICKETS' }
    ];

    return (
        <div className={`${isMobile ? 'flex flex-col gap-6' : 'flex gap-8'} text-xs font-bold tracking-[0.15em] text-slate-400`}>
            {links.map((link) => {
                const isActive = location.pathname === link.path;
                return (
                    <Link
                        key={link.path}
                        to={link.path}
                        onClick={closeMenu}
                        className={`hover:text-white transition-colors relative py-2 ${isActive ? 'text-white' : ''} ${isMobile ? 'text-base' : ''}`}
                    >
                        {link.label}
                        {isActive && (
                            <div className="absolute bottom-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#D4AF37] to-transparent" />
                        )}
                    </Link>
                );
            })}
        </div>
    );
};