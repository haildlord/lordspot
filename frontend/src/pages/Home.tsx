import { useRef, useEffect } from 'react';
import { PulsuatingCountDown } from "../components/PulsuatingCountDown.tsx";
import { useAppData } from '../context/AppDataContext';
import { AnimatedPrizePool } from "../components/AnimatedPrizePool.tsx";
import { RunLordsPotButton } from "../components/RunLordsPotButton.tsx";
import {OnGoingEpoch} from "../components/OnGoingEpoch.tsx";

export const Home = () => {
    // 1. Get isDrawing directly from context
    const { pool_total_cap, ticket_price, isGlobalLoading, isDrawing } = useAppData();
    const price = isGlobalLoading ? "..." : ticket_price / 1e6;
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrame: number;
        let particles: any[] = [];
        let shootingStars: any[] = [];

        const resizeCanvas = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };

        class Particle {
            x: number; y: number; size: number; speed: number; opacity: number; color: string;
            constructor() {
                this.x = Math.random() * canvas.width;
                this.y = Math.random() * canvas.height;
                this.size = Math.random() * 2.5 + 1;
                this.speed = Math.random() * 0.5 + 0.2;
                this.opacity = Math.random();
                this.color = Math.random() > 0.45 ? '#D4AF37' : '#F5F0D8';
            }
            update() {
                this.y -= this.speed;
                this.opacity = Math.sin(Date.now() / 900 + this.x) * 0.5 + 0.5;
                if (this.y < 0) this.y = canvas.height;
            }
            draw() {
                ctx.save();
                ctx.globalAlpha = this.opacity * 0.75;
                ctx.fillStyle = this.color;
                ctx.shadowBlur = this.color === '#D4AF37' ? 10 : 6;
                ctx.shadowColor = this.color;
                ctx.fillRect(this.x, this.y, this.size, this.size);
                ctx.restore();
            }
        }

        class ShootingStar {
            x: number; y: number; length: number; speed: number; opacity: number; color: string;
            constructor() {
                this.x = Math.random() * canvas.width;
                this.y = Math.random() * canvas.height * 0.45;
                this.length = Math.random() * 60 + 40;
                this.speed = Math.random() * 15 + 10;
                this.opacity = 1;
                this.color = Math.random() > 0.5 ? '#D4AF37' : '#F8F4E0';
            }
            update() {
                this.x += this.speed;
                this.y += this.speed * 0.62;
                this.opacity -= 0.019;
            }
            draw() {
                ctx.save();
                ctx.globalAlpha = this.opacity;
                const gradient = ctx.createLinearGradient(this.x, this.y, this.x + this.length, this.y + this.length * 0.65);
                gradient.addColorStop(0, this.color);
                gradient.addColorStop(1, 'transparent');
                ctx.strokeStyle = gradient;
                ctx.lineWidth = 2;
                ctx.shadowBlur = 20;
                ctx.shadowColor = this.color;
                ctx.beginPath();
                ctx.moveTo(this.x, this.y);
                ctx.lineTo(this.x + this.length, this.y + this.length * 0.65);
                ctx.stroke();
                ctx.restore();
            }
        }

        const initParticles = () => {
            particles = [];
            for (let i = 0; i < 100; i++) particles.push(new Particle());
        };

        const animate = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            particles.forEach(p => { p.update(); p.draw(); });
            shootingStars.forEach((star, i) => {
                star.update(); star.draw();
                if (star.opacity <= 0) shootingStars.splice(i, 1);
            });
            if (Math.random() < 0.015) shootingStars.push(new ShootingStar());
            animationFrame = requestAnimationFrame(animate);
        };

        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        initParticles();
        animate();

        return () => {
            window.removeEventListener('resize', resizeCanvas);
            cancelAnimationFrame(animationFrame);
        };
    }, []);

    return (
        <div className="relative min-h-[calc(100vh-64px)] md:min-h-[calc(100vh-80px)] flex flex-col items-center justify-center text-center overflow-hidden bg-[#0a0a0a]">

            {/* 2. OVERLAY CONTROLLED BY CONTEXT */}
            {isDrawing && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm transition-opacity duration-300">
                    <div className="flex flex-col items-center justify-center">
                        <div className="relative flex items-center justify-center mb-5">
                            <div className="absolute w-20 h-20 border-4 border-[#D4AF37]/10 border-t-[#D4AF37] rounded-full animate-spin" />
                            <div className="absolute w-12 h-12 border-4 border-[#D4AF37]/30 border-b-[#D4AF37] rounded-full animate-[spin_1.5s_reverse_infinite]" />
                            <span className="text-2xl">🔮</span>
                        </div>
                        <h2 className="text-xl md:text-2xl font-black text-[#D4AF37] tracking-[0.2em] uppercase animate-pulse">
                            Oracle is Drawing...
                        </h2>
                        <p className="text-sm text-slate-400 mt-2 font-medium">The vault is temporarily locked while winners are chosen.</p>
                    </div>
                </div>
            )}

            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(212,175,55,0.06)_0%,transparent_50%)] pointer-events-none" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(147,51,234,0.04)_0%,transparent_50%)] pointer-events-none" />

            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-0 opacity-70" />

            <div className="relative z-10 w-full max-w-4xl px-4 pt-0 md:pt-2 pb-8 md:pb-12 mt-0">
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 mb-4 md:mb-6">
                    <PulsuatingCountDown />

                    <OnGoingEpoch/>
                </div>

                <div>
                    <AnimatedPrizePool value={pool_total_cap / 1e6} />
                </div>

                <div className="flex justify-center w-full mb-6 md:mb-10 mt-4 md:mt-6">
                    <div className="bg-black/40 backdrop-blur-xl border border-[#D4AF37]/20 shadow-[0_4px_20px_rgba(0,0,0,0.4)] p-3 md:p-4 rounded-2xl md:rounded-3xl w-full max-w-[12rem] md:max-w-[14rem] relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#D4AF37] to-transparent opacity-40" />
                        <p className="text-[#D4AF37]/80 text-[9px] md:text-[10px] font-black tracking-[0.2em] mb-1">PER TICKET PRICE</p>
                        <div className="flex items-baseline justify-center gap-1.5">
                            <p className="text-lg md:text-xl font-black text-white tracking-tight">{price}</p>LUSDC
                        </div>
                    </div>
                </div>

                <div className={isDrawing ? 'opacity-50 pointer-events-none' : ''}>
                    <RunLordsPotButton/>
                </div>
            </div>
        </div>
    );
};