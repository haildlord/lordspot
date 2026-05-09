import { useState, useEffect } from 'react';
import { useAppData } from '../context/AppDataContext';

export const OnGoingEpoch = () => {

    const { current_epoch_id, isGlobalLoading } = useAppData();
    const [ONGOING_EPOCH, setONGOING_EPOCH] = useState<string>("LOADING...");

    useEffect(() => {

        if (isGlobalLoading || !current_epoch_id) return;

        setONGOING_EPOCH(current_epoch_id.toString());

    }, [current_epoch_id, isGlobalLoading]);



    return (
        <div className="inline-flex items-center px-4 md:px-5 py-1.5 md:py-2 rounded-full border border-purple-500/30 bg-purple-500/10 backdrop-blur-md text-purple-200 text-[9px] md:text-[10px] font-black tracking-[0.15em] md:tracking-[0.2em] uppercase shadow-[0_0_15px_rgba(168,85,247,0.15)]">
            ONGOING EPOCH:
            <span className="ml-1.5 text-purple-400 drop-shadow-[0_0_10px_rgba(168,85,247,0.8)] text-[10px] md:text-[12px] font-black tabular-nums">
                {ONGOING_EPOCH}
            </span>
        </div>
    )
}