import { useState, useEffect, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { useAppData } from '../context/AppDataContext'; // Adjust path if needed

// ==========================================
// 1. THE CUSTOM HOOK (Fetches the raw number)
// ==========================================
export const useUserBalance = () => {
    const { connected, publicKey } = useWallet();
    const { connection } = useConnection();
    const { devnet_mock_usdc_mint_address } = useAppData();

    const [balance, setBalance] = useState<number | null>(null);

    const fetchBalance = useCallback(async () => {
        // Ensure all variables exist before attempting to fetch
        if (!connected || !publicKey || !devnet_mock_usdc_mint_address) {
            setBalance(null);
            return;
        }

        try {
            const ata = await getAssociatedTokenAddress(new PublicKey(devnet_mock_usdc_mint_address), publicKey);
            const balanceInfo = await connection.getTokenAccountBalance(ata);
            setBalance(balanceInfo.value.uiAmount);
        } catch (e) {
            // If the ATA doesn't exist, they have 0 tokens.
            setBalance(0);
        }
    }, [connected, publicKey, connection, devnet_mock_usdc_mint_address]);

    useEffect(() => {
        fetchBalance();
        // Automatically refresh balance every 10 seconds to catch post-transaction updates
        const intervalId = setInterval(fetchBalance, 10000);
        return () => clearInterval(intervalId);
    }, [fetchBalance]);

    return { balance, fetchBalance };
};


export const BalanceDisplay = ({ balance }: { balance: number | null }) => {
    return (
        <div className="flex justify-between items-center mb-2 md:mb-3 px-1">
            <span className="text-[9px] md:text-[10px] font-bold tracking-[0.15em] text-slate-400 uppercase">
                Available Balance
            </span>
            <span className="text-[10px] md:text-[11px] font-black tracking-wider text-white">
                {balance !== null ? `${balance.toLocaleString()} LUSDC` : '-- LUSDC'}
            </span>
        </div>
    );
};