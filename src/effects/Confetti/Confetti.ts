/**
 * Lightweight confetti animation - pure JS, no dependencies.
 * Spawns colourful particles over the popup for ~2.5 seconds.
 */
export function triggerConfetti() {
    const canvas = document.createElement("canvas");
    canvas.id = "confetti-canvas";
    // Performance: contain: strict isolates the canvas from layout/paint of the rest of the page.
    // will-change and translateZ force GPU layer promotion immediately.
    canvas.style.cssText =
        "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;contain:strict;will-change:transform;backface-visibility:hidden;transform:translateZ(0);";
    document.body.appendChild(canvas);

    const ctx = canvas.getContext("2d", { alpha: true })!;
    const dpr = window.devicePixelRatio || 1;
    let screenWidth = window.innerWidth;
    let screenHeight = window.innerHeight;

    canvas.width = screenWidth * dpr;
    canvas.height = screenHeight * dpr;
    ctx.scale(dpr, dpr);

    const colors = [
        "#f43f5e", "#8b5cf6", "#3b82f6", "#10b981",
        "#f59e0b", "#ec4899", "#06b6d4", "#84cc16",
    ];

    interface Particle {
        x: number;
        y: number;
        w: number;
        h: number;
        vx: number;
        vy: number;
        color: string;
        r: number;
        rs: number;
        g: number;
        o: number;
        f: number;
        wobble: number;
        wobbleSpeed: number;
    }

    const particles: Particle[] = [];
    const PARTICLE_COUNT = 150;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push({
            x: screenWidth / 2 + (Math.random() - 0.5) * 60,
            y: screenHeight * 0.4 + (Math.random() - 0.5) * 40,
            w: 6 + Math.random() * 8,
            h: 4 + Math.random() * 6,
            vx: (Math.random() - 0.5) * 35,
            vy: -(Math.random() * 15 + 8),
            color: colors[Math.floor(Math.random() * colors.length)],
            r: Math.random() * Math.PI * 2,
            rs: (Math.random() - 0.5) * 0.25,
            g: 0.28,
            o: 1,
            f: 0.97,
            wobble: Math.random() * Math.PI * 2,
            wobbleSpeed: 0.05 + Math.random() * 0.1,
        });
    }

    let lastTime: number | null = null;
    const animationDurationMs = 3500;
    let startTime: number | null = null;

    function animate(now: number) {
        if (startTime === null) {
            startTime = now;
        }

        // Jitter Fix: Initialize lastTime on the first frame to avoid a massive first-frame delta
        if (lastTime === null) {
            lastTime = now;
            requestAnimationFrame(animate);
            return;
        }

        const elapsed = now - startTime;
        const progress = Math.min(elapsed / animationDurationMs, 1);

        // Stabilized delta time (clamped to prevent jumps during frame drops)
        const dt = Math.max(0.1, Math.min((now - lastTime) / 16.67, 3));
        lastTime = now;

        ctx.clearRect(0, 0, screenWidth, screenHeight);

        for (const p of particles) {
            // Physics
            p.vx *= Math.pow(p.f, dt);
            p.vy += p.g * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.r += p.rs * dt;
            p.wobble += p.wobbleSpeed * dt;

            // Cubic fade for smoother end-of-life
            p.o = 1 - Math.pow(progress, 3);

            // Drawing - using save/restore for simplicity but keep it tight
            ctx.save();
            // Wobble adds a natural "falling paper" side-to-side drift
            const xWobble = Math.sin(p.wobble) * 2;
            ctx.translate(p.x + xWobble, p.y);
            ctx.rotate(p.r);
            ctx.globalAlpha = p.o;
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        }

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            canvas.remove();
        }
    }

    requestAnimationFrame(animate);
}
