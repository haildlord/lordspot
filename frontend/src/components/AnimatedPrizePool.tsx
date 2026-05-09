import { useEffect, useState } from 'react';
import { motion, animate } from 'framer-motion';

interface AnimatedPrizeProps {
    value: number;
    label?: string;
}

export const AnimatedPrizePool = ({
    value,
    label = "PRIZE POOL"
 }: AnimatedPrizeProps) => {
    const [displayValue, setDisplayValue] = useState(0);
    const [popScale, setPopScale] = useState(1);

    useEffect(() => {
        const controls = animate(displayValue, value, {
            type: "spring",
            stiffness: 52,
            damping: 13,
            onUpdate: (latest) => setDisplayValue(Math.floor(latest)),
            onComplete: () => {
                setPopScale(1.11);
                setTimeout(() => setPopScale(1), 420);
            }
        });
        return () => controls.stop();
    }, [value]);

    const formattedValue = displayValue.toLocaleString('en-US');

    return (
        <div className="relative flex flex-col items-center select-none">
            <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="mb-4 flex items-center gap-3"
            >
                <div className="h-px w-8 bg-gradient-to-r from-transparent to-[#D4AF37]" />
                <span className="text-[#D4AF37] text-xs font-semibold tracking-[4px] uppercase">
          {label}
        </span>
                <div className="h-px w-8 bg-gradient-to-l from-transparent to-[#D4AF37]" />
            </motion.div>

            <div className="relative">
                <motion.h1
                    animate={{ scale: popScale }}
                    transition={{ type: "spring", stiffness: 420, damping: 14 }}
                    className="relative text-[5.5rem] sm:text-[7rem] md:text-[8.5rem] lg:text-[9.2rem]
                     font-black tracking-[-6.5px] leading-none text-center"
                >
          <span className="relative z-10 text-transparent bg-clip-text
                           bg-gradient-to-br from-[#FFEB3B] via-[#FFD700] to-[#F9A825]">
              <span className="bg-clip-text text-transparent bg-gradient-to-b from-[#F5F5F5] via-[#D0D0D0] to-[#A8A8A8]">
              $
            </span>

              <span className="bg-clip-text text-transparent bg-gradient-to-br from-[#FFEB3B] via-[#FFD700] to-[#F9A825]">
              {formattedValue}
            </span>
          </span>
                </motion.h1>
            </div>

            <div className="absolute inset-0 pointer-events-none -z-10">
                {Array.from({ length: 6 }).map((_, i) => (
                    <motion.div
                        key={i}
                        className="absolute w-[2px] h-[2px] rounded-full bg-[#FFCC00]"
                        style={{ boxShadow: '0 0 6px #FFCC00' }}
                        initial={{
                            left: `${30 + (i % 4) * 12}%`,
                            top: '65%',
                            opacity: 0,
                        }}
                        animate={{
                            top: `${15 + Math.sin(i) * 12}%`,
                            left: `${26 + ((i * 8) % 50)}%`,
                            opacity: [0, 0.85, 0],
                            scale: [0.5, 1.3, 0.5],
                        }}
                        transition={{
                            duration: 2.4 + (i % 3) * 0.5,
                            repeat: Infinity,
                            delay: i * 0.28,
                            ease: "easeInOut",
                        }}
                    />
                ))}
            </div>
        </div>
    );
};