/**
 * Lightweight confetti animation - pure JS, no dependencies.
 * Spawns colourful particles over the popup for ~2.5 seconds.
 */
export function triggerConfetti() {
    const canvas = document.createElement("canvas");
    canvas.id = "confetti-canvas";
    canvas.style.cssText =
        "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;";
    document.body.appendChild(canvas);

    const ctx = canvas.getContext("2d")!;
    let screenWidth = (canvas.width = window.innerWidth);
    let screenHeight = (canvas.height = window.innerHeight);

    const colors = [
        "#f43f5e", "#8b5cf6", "#3b82f6", "#10b981",
        "#f59e0b", "#ec4899", "#06b6d4", "#84cc16",
    ];

    interface Particle {
        x: number;
        y: number;
        particleWidth: number;
        particleHeight: number;
        velocityX: number;
        velocityY: number;
        color: string;
        rotation: number;
        rotationSpeed: number;
        gravity: number;
        opacity: number;
    }

    const particles: Particle[] = [];
    const PARTICLE_COUNT = 80;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push({
            x: screenWidth / 2 + (Math.random() - 0.5) * screenWidth * 0.4,
            y: screenHeight * 0.35 + (Math.random() - 0.5) * 60,
            particleWidth: 6 + Math.random() * 6,
            particleHeight: 4 + Math.random() * 4,
            velocityX: (Math.random() - 0.5) * 12,
            velocityY: -(Math.random() * 8 + 4),
            color: colors[Math.floor(Math.random() * colors.length)],
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.3,
            gravity: 0.15 + Math.random() * 0.1,
            opacity: 1,
        });
    }

    const startTime = performance.now();
    const animationDurationMs = 2500;

    function animate(now: number) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / animationDurationMs, 1);

        ctx.clearRect(0, 0, screenWidth, screenHeight);

        for (const particle of particles) {
            particle.velocityY += particle.gravity;
            particle.x += particle.velocityX;
            particle.y += particle.velocityY;
            particle.rotation += particle.rotationSpeed;
            particle.opacity = 1 - Math.max(0, (progress - 0.6) / 0.4);

            ctx.save();
            ctx.translate(particle.x, particle.y);
            ctx.rotate(particle.rotation);
            ctx.globalAlpha = particle.opacity;
            ctx.fillStyle = particle.color;
            ctx.fillRect(-particle.particleWidth / 2, -particle.particleHeight / 2, particle.particleWidth, particle.particleHeight);
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
