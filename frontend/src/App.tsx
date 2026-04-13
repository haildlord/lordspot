import { useMemo, useState } from 'react';
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
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    return (
        <ConnectionProvider endpoint={endpoint}>
            <WalletProvider wallets={wallets} autoConnect>
                <WalletModalProvider>
                    <Router>
                        <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-black text-white font-sans overflow-x-hidden relative">
                            {/* Premium Navbar */}
                            <nav className="glass border-b border-white/10 sticky top-0 z-50">
                                <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-5">
                                    <div className="flex justify-between items-center">

                                        {/* Logo & Desktop Nav */}
                                        <div className="flex items-center gap-10 shrink-0">
                                            {/* Logo */}
                                            <div className="flex items-center gap-2 md:gap-3 relative z-50">
                                                <div className="w-7 h-7 md:w-9 md:h-9 bg-gradient-to-br from-purple-500 to-amber-400 rounded-xl md:rounded-2xl flex items-center justify-center text-lg md:text-2xl shadow-lg shadow-purple-500/50">
                                                    👑
                                                </div>
                                                {/* Scaled down logo text slightly on mobile to make room for the wallet button */}
                                                <h1 className="text-xl md:text-3xl font-black tracking-tighter neon-purple">
                                                    LORDSPOT
                                                </h1>
                                            </div>

                                            {/* Desktop Navigation */}
                                            <div className="hidden lg:block">
                                                <NavLinks />
                                            </div>
                                        </div>

                                        {/* Wallet Button & Mobile Toggle */}
                                        <div className="flex items-center gap-2 sm:gap-4 relative z-50">
                                            {/* FIXED:
                                                1. Added !whitespace-nowrap to stop text splitting
                                                2. Added shrink-0 to prevent the button from being squashed
                                                3. Added mobile-specific padding (!px-3 !py-2) and text sizes (!text-xs)
                                            */}
                                            <WalletMultiButton className="!bg-gradient-to-r !from-purple-600 !to-amber-500 hover:!from-purple-500 hover:!to-amber-400 !font-bold !text-xs md:!text-base !px-3 md:!px-6 !py-2 md:!py-2.5 !rounded-xl md:!rounded-2xl !transition-all !shadow-lg !shadow-purple-500/30 !whitespace-nowrap shrink-0" />

                                            {/* Hamburger Menu Button */}
                                            <button
                                                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                                                className="lg:hidden p-1 text-slate-300 hover:text-amber-400 transition-colors"
                                                aria-label="Toggle menu"
                                            >
                                                {isMobileMenuOpen ? (
                                                    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                                ) : (
                                                    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Mobile Dropdown Menu */}
                                {isMobileMenuOpen && (
                                    <div className="lg:hidden absolute top-full left-0 w-full bg-slate-950 border-b border-white/10 shadow-2xl">
                                        <div className="px-6 py-8">
                                            <NavLinks isMobile closeMenu={() => setIsMobileMenuOpen(false)} />
                                        </div>
                                    </div>
                                )}
                            </nav>

                            {/* Main Content */}
                            <Toaster position="bottom-right" reverseOrder={false} />
                            <main className="max-w-7xl mx-auto px-4 md:px-6 pt-6 md:pt-8 pb-12 md:pb-20">
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

// Updated NavLinks component
const NavLinks = ({ isMobile = false, closeMenu }: { isMobile?: boolean, closeMenu?: () => void }) => {
    const location = useLocation();
    const links = [
        { path: '/', label: 'GRAND PRIZE' },
        { path: '/buy', label: 'PLAY NOW' },
        { path: '/faucet', label: 'FAUCET' },
        { path: '/my-tickets', label: 'MY VAULT' }
    ];

    return (
        <div className={`${isMobile ? 'flex flex-col gap-8' : 'flex gap-8'} text-sm font-semibold tracking-widest`}>
            {links.map((link) => (
                <Link
                    key={link.path}
                    to={link.path}
                    onClick={closeMenu}
                    className={`hover:text-amber-400 transition-all duration-300 relative w-fit ${location.pathname === link.path ? 'text-amber-400' : 'text-slate-300'} ${isMobile ? 'text-xl' : ''}`}
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