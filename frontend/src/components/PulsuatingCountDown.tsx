import { useState, useEffect } from 'react';
import { useAppData } from '../context/AppDataContext';

export const PulsuatingCountDown = () => {
    const { next_draw_at, isGlobalLoading } = useAppData();
    const [countdown, setCountdown] = useState<string>("LOADING...");

    useEffect(() => {
        if (isGlobalLoading || !next_draw_at) return;

        const targetTime = new Date(next_draw_at).getTime();

        const updateTimer = () => {
            const now = new Date().getTime();
            const diff = targetTime - now;

            if (diff <= 0) {
                setCountdown("DRAWING NOW");
                return;
            }

            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);

            const formattedMinutes = minutes < 10 ? `0${minutes}` : minutes;
            const formattedSeconds = seconds < 10 ? `0${seconds}` : seconds;

            // CHANGED: Use lowercase letters and colons
            setCountdown(`${hours}h:${formattedMinutes}m:${formattedSeconds}s`);
        };

        updateTimer();
        const interval = setInterval(updateTimer, 1000);

        return () => clearInterval(interval);
    }, [next_draw_at, isGlobalLoading]);

    return (
        <div className="inline-flex items-center justify-center px-4 md:px-5 h-8 md:h-9 rounded-full border border-purple-500/30 bg-purple-500/10 backdrop-blur-md text-purple-200 shadow-[0_0_15px_rgba(168,85,247,0.15)] transition-all duration-300">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse bg-purple-400 drop-shadow-[0_0_8px_rgba(168,85,247,0.8)] mr-2 md:mr-2.5" />

            <span className="text-[9px] md:text-[10px] font-black tracking-[0.15em] md:tracking-[0.2em] uppercase leading-none">
                DRAWING IN:
            </span>

            {/* CHANGED: Removed the 'uppercase' class from this span */}
            <span className="ml-1.5 text-purple-400 drop-shadow-[0_0_10px_rgba(168,85,247,0.8)] text-[10px] md:text-[12px] font-black leading-none tabular-nums">
                {countdown}
            </span>
        </div>
    );
};