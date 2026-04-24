import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { useAnchorProgram } from '../lib/anchor.ts';
import { toast } from 'react-hot-toast';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';
import { CoinCanvas } from '../components/CoinCanvas';

const MOCK_USDC_MINT = new PublicKey('6EkfBDuK9TkW3dxFaWqX1rQit9gmYgo4eUMmZVs6H7wH');
const FAUCET_PROGRAM_ID = new PublicKey('9aURuK86pik3LVQT3nCEF466CfKcKVmNWiETkGegBjx7');

export const Faucet = () => {
    const { publicKey, connected } = useWallet();
    const { program } = useAnchorProgram();

    const [requestedAmount, setRequestedAmount] = useState<number | ''>('');
    const [userMinted, setUserMinted] = useState(0);
    const [loading, setLoading] = useState(false);

    const MAX_PER_WALLET = 30000;
    const remaining = MAX_PER_WALLET - userMinted;

    const handleMint = async () => { /* your existing logic */ };

    return (
        // Added a subtle amber glow to the background to break the flat black
        <div className="relative min-h-[calc(100vh-80px)] flex flex-col md:flex-row">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_right,rgba(212,175,55,0.05)_0%,transparent_50%)] pointer-events-none" />

            <div className="w-full md:w-1/2 h-[45vh] md:h-screen relative flex-shrink-0 z-10">
                <CoinCanvas />
            </div>

            <div className="w-full md:w-1/2 min-h-[55vh] md:h-screen flex items-center justify-center p-6 sm:p-12 z-10">
                <div className="w-full max-w-md premium-glass rounded-[2rem] p-8 md:p-12">

                    <div className="text-center mb-10">
                        <p className="text-[#D4AF37] text-xs font-bold tracking-[0.2em] mb-2">DEVELOPER TOOLS</p>
                        <h2 className="text-3xl font-black tracking-tight text-white">LUSDC FAUCET</h2>
                    </div>

                    {!connected ? (
                        <div className="text-center py-10 px-4 border border-white/5 rounded-2xl bg-white/[0.02] text-slate-400 font-medium tracking-wide">
                            Wallet connection required.
                        </div>
                    ) : (
                        <div className="flex flex-col gap-8">
                            <input
                                type="number"
                                min="1"
                                placeholder="0"
                                value={requestedAmount}
                                onChange={(e) => setRequestedAmount(e.target.value ? Number(e.target.value) : '')}
                                className="w-full bg-black/20 border border-white/10 rounded-2xl text-white text-center text-6xl py-8 focus:outline-none focus:border-[#D4AF37]/50 placeholder:text-slate-800 font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none transition-colors"
                            />

                            <button
                                onClick={handleMint}
                                disabled={loading || remaining <= 0 || !requestedAmount || Number(requestedAmount) > remaining}
                                className="w-full py-5 text-sm font-bold tracking-[0.15em] bg-[#D4AF37] text-black hover:bg-[#FFD700] rounded-xl transition-all disabled:opacity-20"
                                style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
                            >
                                {loading ? "PROCESSING..." : "MINT lUSDC"}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};