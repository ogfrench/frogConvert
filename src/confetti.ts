/**
 * Lightweight confetti animation — pure JS, no dependencies.
 * Spawns colourful particles over the popup for ~2.5 seconds.
 */
export function triggerConfetti() {
    const canvas = document.createElement("canvas");
    canvas.id = "confetti-canvas";
    canvas.style.cssText =
        "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;";
    document.body.appendChild(canvas);

    const ctx = canvas.getContext("2d")!;
    let W = (canvas.width = window.innerWidth);
    let H = (canvas.height = window.innerHeight);

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
        rotation: number;
        rotSpeed: number;
        gravity: number;
        opacity: number;
    }

    const particles: Particle[] = [];
    const PARTICLE_COUNT = 80;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push({
            x: W / 2 + (Math.random() - 0.5) * W * 0.4,
            y: H * 0.35 + (Math.random() - 0.5) * 60,
            w: 6 + Math.random() * 6,
            h: 4 + Math.random() * 4,
            vx: (Math.random() - 0.5) * 12,
            vy: -(Math.random() * 8 + 4),
            color: colors[Math.floor(Math.random() * colors.length)],
            rotation: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.3,
            gravity: 0.15 + Math.random() * 0.1,
            opacity: 1,
        });
    }

    const startTime = performance.now();
    const DURATION = 2500;

    function animate(now: number) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / DURATION, 1);

        ctx.clearRect(0, 0, W, H);

        for (const p of particles) {
            p.vy += p.gravity;
            p.x += p.vx;
            p.y += p.vy;
            p.rotation += p.rotSpeed;
            p.opacity = 1 - Math.max(0, (progress - 0.6) / 0.4);

            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);
            ctx.globalAlpha = p.opacity;
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
