import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import IDL from '../idl/lords_pot.json';
import { calculateTrueLpState, type TrueLpState } from '../utility/lpMath';

interface AppData {
    next_draw_at: string;
    pool_total_cap: number;
    ticket_price: number;
    current_epoch_id: number;
    prize_pool: number;
    isGlobalLoading: boolean;
    normal_marble_max: number;
    total_tickets: number;
    special_marble_max: number;
    lp_target_percent: number;
    devnet_protocol_programid: string;
    switchboard_random_account: string;
    authority_switchboard_random_account: string;
    devnet_mock_usdc_mint_address: string;
    devnet_mock_usdc_program_address: string;
    devnet_swtichboard_queue: string;
    devnet_swtichboard_programid: string;

    lpInfo: TrueLpState | null;
    activityLogs: any[];
    userTicketCount: number;
    isUserLoading: boolean;
    isDrawing: boolean;
    lastEpochUpdate: number;

    refreshVaultData: () => Promise<void>;
}

const AppDataContext = createContext<AppData | undefined>(undefined);

export const AppDataProvider = ({ children }: { children: React.ReactNode }) => {
    const { connected, publicKey, wallet } = useWallet();
    const { connection } = useConnection();

    const [globalConfig, setGlobalConfig] = useState({
        next_draw_at: '',
        pool_total_cap: 0,
        ticket_price: 0,
        current_epoch_id: 0,
        prize_pool: 0,
        normal_marble_max: 0,
        total_tickets: 0,
        special_marble_max: 0,
        lp_target_percent: 0,
        devnet_protocol_programid: '',
        switchboard_random_account: '',
        authority_switchboard_random_account: '',
        devnet_mock_usdc_mint_address: '',
        devnet_mock_usdc_program_address: '',
        devnet_swtichboard_queue: '',
        devnet_swtichboard_programid: '',
        isGlobalLoading: true,
        isDrawing : false,
    });

    const [lpInfo, setLpInfo] = useState<TrueLpState | null>(null);
    const [activityLogs, setActivityLogs] = useState<any[]>([]);
    const [userTicketCount, setUserTicketCount] = useState<number>(0);
    const [isUserLoading, setIsUserLoading] = useState<boolean>(false);
    const [lastEpochUpdate, setLastEpochUpdate] = useState<number>(Date.now());

    const isDrawingRef = useRef(globalConfig.isDrawing);
    useEffect(() => { isDrawingRef.current = globalConfig.isDrawing; }, [globalConfig.isDrawing]);

    const fetchGlobalConfig = async () => {
        const { data, error } = await supabase.from('global_config').select('*').single();
        if (!error && data) {
            setGlobalConfig({
                next_draw_at: data.next_draw_at || '',
                pool_total_cap: Number(data.pool_total_cap) || 0,
                ticket_price: Number(data.ticket_price) || 0,
                current_epoch_id: Number(data.current_epoch_id) || 0,
                prize_pool: Number(data.prize_pool) || 0,
                normal_marble_max: Number(data.normal_marble_max) || 0,
                total_tickets: Number(data.total_tickets) || 0,
                special_marble_max: Number(data.special_marble_max) || 0,
                devnet_protocol_programid: data.devnet_protocol_programid || '',
                switchboard_random_account: data.switchboard_random_account || '',
                authority_switchboard_random_account: data.authority_switchboard_random_account || '',
                devnet_mock_usdc_mint_address: data.devnet_mock_usdc_mint_address || '',
                devnet_mock_usdc_program_address: data.devnet_mock_usdc_program_address || '',
                devnet_swtichboard_queue: data.devnet_swtichboard_queue || '',
                devnet_swtichboard_programid: data.devnet_swtichboard_programid || '',
                lp_target_percent : Number(data.lp_target_percent) || 0,
                isGlobalLoading: false,
                isDrawing : data.is_drawing || false,
            });
        }
    };

    const refreshVaultData = useCallback(async () => {
        if (!connected || !publicKey || !wallet || !connection || globalConfig.isGlobalLoading) {
            setLpInfo(null);
            setActivityLogs([]);
            setUserTicketCount(0);
            return;
        }

        setIsUserLoading(true);

        try {
            const provider = new AnchorProvider(connection, wallet.adapter as any, AnchorProvider.defaultOptions());
            const program = new Program(IDL as any, provider);

            const trueState = await calculateTrueLpState(program, publicKey, globalConfig.current_epoch_id);
            setLpInfo(trueState);

            const { data: logs, error: logsError } = await supabase
                .from('lp_activity_logs')
                .select('*')
                .eq('user_address', publicKey.toString())
                .order('created_at', { ascending: false })
                .limit(5);

            if (!logsError && logs) setActivityLogs(logs);

            const { count, error: countError } = await supabase
                .from('ticket_purchases')
                .select('*', { count: 'exact', head: true })
                .eq('epoch_id', globalConfig.current_epoch_id)
                .eq('buyer_address', publicKey.toString());

            if (!countError) setUserTicketCount(count || 0);

        } catch (error) {
            console.error("Failed to fetch user vault data:", error);
        } finally {
            setIsUserLoading(false);
        }
    }, [connected, publicKey, wallet, connection, globalConfig.current_epoch_id, globalConfig.isGlobalLoading]);

    useEffect(() => {
        fetchGlobalConfig();

        const subscription = supabase.channel('global_config_changes')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'global_config' },
                (payload) => {
                    const newlyUnlocked = isDrawingRef.current === true && payload.new.is_drawing === false;
                    fetchGlobalConfig();

                    if (newlyUnlocked) {
                        console.log("⚡ Context Detected Epoch Rollover! Updating app state...");
                        setLastEpochUpdate(Date.now());
                        refreshVaultData();
                    }
                })
            .subscribe();

        return () => { supabase.removeChannel(subscription); };
    }, [refreshVaultData]);

    useEffect(() => {
        refreshVaultData();
        const interval = setInterval(refreshVaultData, 15000);
        return () => clearInterval(interval);
    }, [refreshVaultData]);

    return (
        <AppDataContext.Provider value={{
            ...globalConfig,
            lpInfo,
            activityLogs,
            userTicketCount,
            isUserLoading,
            lastEpochUpdate,
            refreshVaultData,
        }}>
            {children}
        </AppDataContext.Provider>
    );
};

export const useAppData = () => {
    const context = useContext(AppDataContext);
    if (!context) throw new Error("useAppData must be used within AppDataProvider");
    return context;
};