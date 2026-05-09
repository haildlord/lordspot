import { useMemo, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import '@solana/wallet-adapter-react-ui/styles.css';

import { AppDataProvider } from './context/AppDataContext';

import { Home } from './pages/Home';
import { BuyTickets } from './pages/BuyTickets';
import { Faucet } from './pages/Faucet';
import { MyTickets } from './pages/MyTickets';
import { LpVault } from './pages/LpVault';
import { Results } from './pages/Results.tsx';



export const App = () => {
    const apiKey = import.meta.env.VITE_HELIUS_API_KEY
    const endpoint = `https://devnet.helius-rpc.com/?api-key=${apiKey}`;

    const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    return (
        <ConnectionProvider endpoint={endpoint}>
            <WalletProvider wallets={wallets} autoConnect>
                <WalletModalProvider>
                    <AppDataProvider>
                        <Router>
                            <div className="min-h-screen text-white font-sans relative bg-[#0a0a0a]">

                                {/* Ambient Global Background Orbs */}
                                <div className="fixed inset-0 overflow-hidden pointer-events-none">
                                    <div className="absolute -top-[10%] -right-[10%] w-[50%] h-[50%] bg-[#D4AF37]/5 blur-[120px] rounded-full" />
                                    <div className="absolute -bottom-[10%] -left-[10%] w-[50%] h-[50%] bg-purple-600/5 blur-[120px] rounded-full" />
                                </div>

                                {/* Ultra-Premium Glass Navbar */}
                                <nav className="sticky top-0 z-[100] w-full h-16 md:h-20 bg-[#0B0F19]/80 backdrop-blur-xl border-b border-white/5">
                                    <div className="max-w-7xl mx-auto px-4 md:px-8 py-3 md:py-4 h-full flex items-center justify-between">

                                        {/* Logo & Desktop Nav */}
                                        <div className="flex items-center gap-6 md:gap-12 shrink-0">
                                            <Link to="/" className="flex items-center gap-2 md:gap-3 relative z-50 group">
                                                <h1 className="text-xl md:text-2xl font-black tracking-[0.2em] text-white">
                                                    LORDS<span className="text-[#D4AF37]">POT</span>
                                                </h1>
                                            </Link>

                                            <div className="hidden lg:block">
                                                <NavLinks />
                                            </div>
                                        </div>

                                        {/* Wallet & Mobile Toggle */}
                                        <div className="flex items-center gap-3 md:gap-4 relative z-50">
                                            <WalletMultiButton className="!bg-white/5 hover:!bg-white/10 !border !border-white/10 !text-white !font-semibold !text-xs md:!text-sm !px-4 md:!px-6 !py-2 md:!py-3 !rounded-lg md:!rounded-xl !transition-all !whitespace-nowrap shrink-0 !h-auto" />

                                            <button
                                                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                                                className="lg:hidden p-2 text-slate-400 hover:text-white transition-colors"
                                            >
                                                <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isMobileMenuOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Mobile Menu Dropdown */}
                                    {isMobileMenuOpen && (
                                        <div className="lg:hidden absolute top-full left-0 w-full bg-[#0B0F19]/95 backdrop-blur-2xl border-b border-white/5 shadow-2xl animate-fade-in">
                                            <div className="px-6 py-8">
                                                <NavLinks isMobile closeMenu={() => setIsMobileMenuOpen(false)} />
                                            </div>
                                        </div>
                                    )}
                                </nav>

                                {/* Main Application Content */}
                                <main className="relative w-full z-10">
                                    <Routes>
                                        <Route path="/" element={<Home />} />
                                        <Route path="/faucet" element={<Faucet />} />
                                        <Route path="/vault" element={<LpVault />} />
                                        <Route path="/buy-tickets" element={<BuyTickets />} />
                                        <Route path="/my-tickets" element={<MyTickets />} />
                                        <Route path="/results" element={ <Results /> } />
                                    </Routes>
                                </main>

                            </div>
                        </Router>
                    </AppDataProvider>
                </WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
};

// --- Sub-Component: Navigation Links ---
const NavLinks = ({ isMobile = false, closeMenu }: { isMobile?: boolean, closeMenu?: () => void }) => {
    const location = useLocation();
    const links = [
        { path: '/', label: 'HOME' },
        { path: '/faucet', label: 'FAUCET' },
        { path: '/vault', label: 'VAULT' },
        { path: '/buy-tickets', label: 'BUY TICKETS' },
        { path: '/my-tickets', label: 'MY TICKETS' },
        { path: '/results', label: 'RESULTS' }
    ];

    return (
        <div className={`${isMobile ? 'flex flex-col gap-5' : 'flex gap-6 md:gap-8'} text-[10px] md:text-xs font-bold tracking-[0.15em] text-slate-400`}>
            {links.map((link) => {
                const isActive = location.pathname === link.path;
                return (
                    <Link
                        key={link.path}
                        to={link.path}
                        onClick={closeMenu}
                        className={`hover:text-white transition-colors relative py-1.5 md:py-2 flex items-center ${isActive ? 'text-white' : ''} ${isMobile ? 'text-base' : ''}`}
                    >
                        {link.label}
                        {isActive && (
                            <div className="absolute bottom-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#D4AF37] to-transparent shadow-[0_0_8px_rgba(212,175,55,0.5)]" />
                        )}
                    </Link>
                );
            })}
        </div>
    );
};