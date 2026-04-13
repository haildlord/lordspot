import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { useAnchorProgram } from '../lib/anchor.ts';
import { toast } from 'react-hot-toast';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';

const MOCK_USDC_MINT = new PublicKey('6EkfBDuK9TkW3dxFaWqX1rQit9gmYgo4eUMmZVs6H7wH');
const FAUCET_PROGRAM_ID = new PublicKey('9aURuK86pik3LVQT3nCEF466CfKcKVmNWiETkGegBjx7');

export const Faucet = () => {
    const { publicKey, connected } = useWallet();
    const { program } = useAnchorProgram();

    const [requestedAmount, setRequestedAmount] = useState(10000);
    const [userMinted, setUserMinted] = useState(0);
    const [loading, setLoading] = useState(false);

    const MAX_PER_WALLET = 30000;
    const remaining = MAX_PER_WALLET - userMinted;

    const checkMintAuthority = async () => {
        if (!program) return;
        try {
            const mintAccount = await program.provider.connection.getParsedAccountInfo(MOCK_USDC_MINT);
            const authority = (mintAccount.value?.data as any)?.parsed?.info?.mintAuthority;
            console.log("🔍 Current Mint Authority:", authority);
            toast.info(`Mint Authority: ${authority ? authority.slice(0, 8) + '...' : 'None'}`);
        } catch (e) {
            console.error(e);
        }
    };

    const handleMint = async () => {
        if (!publicKey || !connected || !program) {
            toast.error("Connect wallet first");
            return;
        }

        if (requestedAmount > remaining) {
            toast.error("Amount exceeds your remaining allowance");
            return;
        }

        setLoading(true);
        const toastId = toast.loading("Minting Lords USDC...");

        try {
            const destinationAta = await getAssociatedTokenAddress(MOCK_USDC_MINT, publicKey);

            const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
                [new TextEncoder().encode("mint_authority")],
                FAUCET_PROGRAM_ID
            );

            const txSignature = await program.methods
                .mintMockUsdc(new BN(requestedAmount * 1_000_000))
                .accounts({
                    signer: publicKey,
                    mint: MOCK_USDC_MINT,
                    destination: destinationAta,
                    mintAuthorityPda: mintAuthorityPda,
                    tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
                    associatedTokenProgram: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
                    systemProgram: SystemProgram.programId,
                })
                .rpc({ skipPreflight: true });

            toast.success(`✅ ${requestedAmount} lUSDC Minted!`, { id: toastId });
            setUserMinted(prev => prev + requestedAmount);
        } catch (err: any) {
            console.error("Full Mint Error:", err);
            const errorMsg = err.message || err.logs?.join("\n") || "Mint failed";
            toast.error(`❌ ${errorMsg}`, { id: toastId });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto pt-6 md:pt-12 px-2 sm:px-0">
            <div className="glass rounded-2xl md:rounded-3xl p-6 md:p-10 border border-amber-400/30">
                <h2 className="text-3xl md:text-5xl font-black mb-2 text-center break-words">🪙 LORDS USDC FAUCET</h2>
                <p className="text-slate-400 text-center mb-8 md:mb-10 text-sm md:text-base">Free test tokens for LordsPot</p>

                {!connected ? (
                    <div className="text-center py-12 text-slate-400 text-lg md:text-xl">
                        Connect wallet to access faucet
                    </div>
                ) : (
                    <>
                        <div className="flex justify-center w-full">
                            <button
                                onClick={checkMintAuthority}
                                className="text-xs mb-6 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-center"
                            >
                                🔍 Debug Mint Authority
                            </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 md:gap-8 mb-8 md:mb-10 text-center sm:text-left">
                            <div className="bg-slate-900/40 p-4 rounded-xl sm:bg-transparent sm:p-0">
                                <p className="text-xs md:text-sm text-slate-400">TOTAL MINTED BY YOU</p>
                                <p className="text-5xl md:text-6xl font-bold text-amber-400">{userMinted}</p>
                            </div>
                            <div className="bg-slate-900/40 p-4 rounded-xl sm:bg-transparent sm:p-0">
                                <p className="text-xs md:text-sm text-slate-400">REMAINING ALLOWANCE</p>
                                <p className="text-5xl md:text-6xl font-bold text-white">{remaining}</p>
                                <p className="text-[10px] md:text-xs text-slate-500 mt-1">of 30,000 lUSDC (Session)</p>
                            </div>
                        </div>

                        <div className="mb-8">
                            <label className="block text-sm font-medium mb-3 text-slate-400 text-center sm:text-left">Amount to mint</label>
                            <div className="grid grid-cols-2 sm:flex gap-3">
                                {[5000, 10000, 20000, 30000].map((amt) => (
                                    <button
                                        key={amt}
                                        onClick={() => setRequestedAmount(amt)}
                                        disabled={amt > remaining}
                                        className={`flex-1 py-3 md:py-4 rounded-xl md:rounded-2xl font-bold text-sm md:text-base transition-all ${
                                            requestedAmount === amt ? "bg-amber-400 text-slate-950 shadow-lg shadow-amber-400/20" : "bg-slate-800 hover:bg-slate-700 text-white"
                                        } disabled:opacity-30`}
                                    >
                                        {amt}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <button
                            onClick={handleMint}
                            disabled={loading || remaining <= 0 || requestedAmount > remaining}
                            className="w-full py-5 md:py-7 text-lg md:text-2xl font-black bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-950 rounded-2xl md:rounded-3xl hover:scale-105 transition-all disabled:opacity-50 shadow-xl shadow-amber-500/20"
                        >
                            {loading ? "MINTING ON SOLANA..." : `MINT ${requestedAmount} lUSDC`}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};