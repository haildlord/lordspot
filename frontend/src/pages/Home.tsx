import React, { useRef, useEffect } from 'react';

export const Home = () => {
    const currentPrize = "1,100,000";
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
            x: number;
            y: number;
            size: number;
            speed: number;
            opacity: number;
            color: string;
            constructor() {
                this.x = Math.random() * canvas.width;
                this.y = Math.random() * canvas.height;
                this.size = Math.random() * 3.2 + 1;
                this.speed = Math.random() * 0.7 + 0.25;
                this.opacity = Math.random();
                // Mix of gold and soft white
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
                ctx.shadowBlur = this.color === '#D4AF37' ? 14 : 10;
                ctx.shadowColor = this.color;
                ctx.fillRect(this.x, this.y, this.size, this.size);
                ctx.restore();
            }
        }

        class ShootingStar {
            x: number;
            y: number;
            length: number;
            speed: number;
            opacity: number;
            color: string;
            constructor() {
                this.x = Math.random() * canvas.width;
                this.y = Math.random() * canvas.height * 0.45;
                this.length = Math.random() * 85 + 55;
                this.speed = Math.random() * 19 + 13;
                this.opacity = 1;
                // Mix of gold and white shooting stars
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
                ctx.lineWidth = 2.8;
                ctx.shadowBlur = 28;
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
            for (let i = 0; i < 130; i++) {
                particles.push(new Particle());
            }
        };

        const animate = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Particles
            particles.forEach(p => {
                p.update();
                p.draw();
            });

            // Shooting Stars
            shootingStars.forEach((star, i) => {
                star.update();
                star.draw();
                if (star.opacity <= 0) shootingStars.splice(i, 1);
            });

            // Occasional shooting star
            if (Math.random() < 0.018) {
                shootingStars.push(new ShootingStar());
            }

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
        <div className="relative min-h-[calc(100vh-80px)] flex flex-col items-center justify-center text-center overflow-hidden">

            {/* Subtle White + Gold Background Animation */}
            <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full pointer-events-none z-[-1] opacity-75"
            />

            {/* Existing purple radial glow */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(147,51,234,0.08)_0%,transparent_60%)] z-[-1]" />

            <div className="relative z-10 w-full max-w-5xl px-4 pt-10 pb-20">
                {/* Sleek Live Badge */}
                <div className="inline-flex items-center gap-3 px-6 py-2.5 rounded-full border bg-black/50 backdrop-blur-md text-xs font-black tracking-[0.2em] mb-12 animate-urgent">
                    <div className="w-2.5 h-2.5 rounded-full animate-pulse bg-current" style={{ boxShadow: '0 0 12px currentColor' }} />
                    DRAWING IN 4H 12M
                </div>

                {/* Monumental Jackpot */}
                <div className="mb-12">
                    <p className="text-slate-500 text-sm font-semibold tracking-[0.3em] mb-4">THE GRAND POOL</p>
                    <h1 className="text-7xl sm:text-8xl md:text-[11rem] font-black tracking-tighter text-glow-gold leading-none">
                        $<span className="text-[#D4AF37]">{currentPrize}</span>
                    </h1>
                </div>

                <p className="text-lg md:text-xl text-slate-400 font-light mb-16 tracking-wide">
                    The premier on-chain lottery. <span className="text-white font-medium">Winner takes all.</span>
                </p>

                {/* Premium Glass Stats */}
                <div className="flex justify-center w-full mb-16">
                    <div className="premium-glass p-6 rounded-2xl w-full max-w-xs">
                        <p className="text-slate-500 text-xs font-bold tracking-[0.15em] mb-2">PER TICKET PRICE</p>
                        <p className="text-2xl font-bold text-white tracking-wide">1 USDC</p>
                    </div>
                </div>

                <a
                    href="/buy"
                    className="inline-block px-12 py-5 bg-white text-black text-sm font-black tracking-[0.15em] rounded-full hover:scale-105 hover:bg-[#D4AF37] transition-all duration-300 shadow-[0_0_30px_rgba(255,255,255,0.1)]"
                >
                    BUY TICKETS
                </a>
            </div>
        </div>
    );
};