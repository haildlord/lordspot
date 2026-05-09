import { useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { useAnchorProgram } from '../lib/anchor.ts';
import { BN } from '@coral-xyz/anchor';
import { CoinCanvas } from '../components/CoinCanvas';
import {useAppData} from "../context/AppDataContext.tsx";
import {getLusdcMintAuthorityPda, getUserMintATA} from "../../../tests/utils/seeds_and_ata.ts";

export const Faucet = () => {
    const { publicKey, connected } = useWallet();
    const { connection } = useConnection();
    const { program } = useAnchorProgram();
    const { devnet_mock_usdc_mint_address, isGlobalLoading} = useAppData();

    const [requestedAmount, setRequestedAmount] = useState<number | ''>('');
    const [txState, setTxState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

    const handleMint = async () => {

        const amount = Number(requestedAmount);

        if (!publicKey || !connected || !program || isGlobalLoading) return;

        setTxState('loading');

        try {
            const destinationAta = getUserMintATA(publicKey);
            const [mintAuthorityPda] = getLusdcMintAuthorityPda();

            const txSignature = await program.methods
                .mintMockUsdc(new BN(amount * 1_000_000))
                .accounts({
                    signer: publicKey,
                    mint: new PublicKey(devnet_mock_usdc_mint_address),
                    destination: destinationAta,
                    mintAuthorityPda: mintAuthorityPda,
                    tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
                    associatedTokenProgram: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
                    systemProgram: SystemProgram.programId,
                })
                .rpc({ skipPreflight: true });

            const latestBlockhash = await connection.getLatestBlockhash();
            const confirmation = await connection.confirmTransaction({
                signature: txSignature,
                blockhash: latestBlockhash.blockhash,
                lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
            });

            if (confirmation.value.err) throw new Error("Transaction failed.");

            setTxState('success');
            setTimeout(() => { setTxState('idle'); setRequestedAmount(''); }, 3000);
        } catch (err: any) {
            console.error("Full Mint Error:", err);
            setTxState('error');
            setTimeout(() => setTxState('idle'), 3000);
        }
    };

    return (
        <div className="relative min-h-[calc(100vh-64px)] md:min-h-[calc(100vh-80px)] flex flex-col lg:flex-row bg-[#0a0a0a] overflow-hidden">

            {/* --- CUSTOM OVERLAY LOADER --- */}
            {txState !== 'idle' && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md transition-opacity duration-300 p-4">
                    <div className="w-56 h-56 md:w-64 md:h-64 bg-gradient-to-b from-[#1a1a1a] to-[#0d0d0d] border border-[#D4AF37]/30 rounded-[2rem] shadow-[0_0_40px_rgba(212,175,55,0.15)] flex flex-col items-center justify-center relative overflow-hidden">
                        {txState === 'loading' && (
                            <>
                                <div className="relative flex items-center justify-center mb-5">
                                    <div className="absolute w-16 h-16 md:w-20 md:h-20 border-4 border-[#D4AF37]/10 border-t-[#D4AF37] rounded-xl animate-spin" />
                                    <div className="absolute w-10 h-10 md:w-12 md:h-12 border-4 border-[#D4AF37]/30 border-b-[#D4AF37] rounded-lg animate-[spin_1.5s_reverse_infinite]" />
                                    <div className="w-4 h-4 bg-[#D4AF37] rounded-sm animate-pulse" />
                                </div>
                                <p className="text-[#D4AF37] font-bold tracking-[0.2em] text-[10px] md:text-xs animate-pulse">DRAWING FUNDS...</p>
                            </>
                        )}
                        {txState === 'success' && (
                            <div className="animate-[scale-in_0.4s_cubic-bezier(0.175,0.885,0.32,1.275)] flex flex-col items-center">
                                <div className="w-16 h-16 md:w-20 md:h-20 bg-green-500/10 rounded-full flex items-center justify-center mb-3 border border-green-500/30">
                                    <svg className="w-8 h-8 md:w-10 md:h-10 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                </div>
                                <p className="text-green-400 font-black tracking-[0.1em] text-sm md:text-base drop-shadow-md">MINT SUCCESSFUL</p>
                            </div>
                        )}
                        {txState === 'error' && (
                            <div className="animate-[scale-in_0.4s_cubic-bezier(0.175,0.885,0.32,1.275)] flex flex-col items-center">
                                <div className="w-16 h-16 md:w-20 md:h-20 bg-red-500/10 rounded-full flex items-center justify-center mb-3 border border-red-500/30">
                                    <svg className="w-8 h-8 md:w-10 md:h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                </div>
                                <p className="text-red-400 font-black tracking-[0.1em] text-sm md:text-base drop-shadow-md">MINT FAILED</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* --- BACKGROUNDS --- */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(212,175,55,0.06)_0%,transparent_50%)] pointer-events-none" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(107,33,168,0.05)_0%,transparent_50%)] pointer-events-none" />


            {/* Canvas Section */}
            <div className="w-full lg:w-1/2 h-[40vh] lg:h-auto relative flex-shrink-0 z-10">
                <CoinCanvas />
            </div>

            {/* Form Section */}
            <div className="w-full lg:w-1/2 flex items-center justify-center p-4 sm:p-8 lg:p-12 z-10 mt-[-5vh] lg:mt-0 relative">

                {/* FROSTED GLASS FAUCET BOX */}
                <div className="w-full max-w-md bg-[#0a0a0a]/30 backdrop-blur-2xl border border-[#D4AF37]/20 shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_0_20px_rgba(212,175,55,0.05)] rounded-[2rem] p-6 md:p-10 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#D4AF37] to-transparent opacity-30" />

                    <div className="text-center mb-8 md:mb-10">
                        <p className="text-[#D4AF37] text-[10px] md:text-xs font-black tracking-[0.3em] mb-2 drop-shadow-md"><b>LUSDC</b></p>
                        <h2 className="text-3xl md:text-4xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-[#a3a3a3]">
                            FAUCET
                        </h2>
                    </div>

                    {!connected ? (
                        <div className="text-center py-8 md:py-10 px-4 border border-white/5 rounded-2xl bg-black/50 text-slate-400 text-sm md:text-base font-medium tracking-wide shadow-inner">
                            Prove you’re worthy of the Lord’s token—earn His divine trust by connecting your wallet (He’s watching 👀).
                        </div>
                    ) : (
                        <div className="flex flex-col gap-6">
                            <div className="relative group">
                                <div className="absolute -inset-0.5 bg-gradient-to-r from-[#D4AF37]/20 to-[#FFDF73]/20 rounded-2xl blur opacity-30 group-focus-within:opacity-100 transition duration-500" />
                                <div className="relative bg-black/60 border border-[#D4AF37]/30 rounded-2xl flex flex-col items-center pt-6 md:pt-8 pb-3 md:pb-4 shadow-inner">
                                    <div className="flex items-center justify-center w-full px-4 md:px-6">
                                        <span className="text-3xl md:text-4xl text-[#D4AF37] font-black mr-2 select-none drop-shadow-md">$</span>
                                        <input
                                            type="number"
                                            min="1"
                                            placeholder="0"
                                            value={requestedAmount}
                                            onChange={(e) => setRequestedAmount(e.target.value ? Number(e.target.value) : '')}
                                            className="w-full bg-transparent text-white text-4xl md:text-5xl focus:outline-none placeholder:text-zinc-700 font-black tracking-tight [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none drop-shadow-md"
                                        />
                                    </div>
                                    <div className="mt-4 md:mt-6 h-5 md:h-6">
                                        {requestedAmount ? (
                                            <p className="text-xs md:text-sm font-medium tracking-wide text-[#D4AF37]/80 animate-fade-in bg-black/40 px-3 py-1 rounded-full backdrop-blur-md border border-[#D4AF37]/10">
                                                You are going to mint <span className="text-[#D4AF37] font-bold">${requestedAmount.toLocaleString()}</span> dollars.
                                            </p>
                                        ) : (
                                            <p className="text-xs md:text-sm font-medium tracking-wide text-zinc-500">
                                                Enter your desired amount of LUSDC to mint
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={handleMint}
                                disabled={txState === 'loading' || !requestedAmount || Number(requestedAmount) <= 0}
                                className="relative w-full py-4 md:py-5 overflow-hidden group rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(212,175,55,0.1)] active:scale-95"
                            >
                                <div className="absolute inset-0 bg-gradient-to-r from-[#B8860B] via-[#FFD700] to-[#B8860B] bg-[length:200%_100%] animate-[gradient_2s_linear_infinite]" />
                                <div className="absolute inset-[2px] bg-[#111]/90 backdrop-blur-sm rounded-[10px] group-hover:bg-transparent transition-colors duration-300 z-0" />
                                <span className="relative z-10 text-xs md:text-sm font-black tracking-[0.25em] text-[#D4AF37] group-hover:text-black transition-colors duration-300 drop-shadow-md">
                                    {txState === 'loading' ? "ROLLING..." : "MINT"}
                                </span>
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};