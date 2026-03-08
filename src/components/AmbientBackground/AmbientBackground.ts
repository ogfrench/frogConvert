import { MOBILE_BREAKPOINT, PARALLAX_MAX_DIST, PARALLAX_STRENGTH } from "../store/store.ts";

// --- Ambient Visuals ---
export function initParallax() {
  // Don't init on touch devices
  if (window.matchMedia("(pointer: coarse)").matches) return;

  const bgSpans = Array.from(document.querySelectorAll("#bg-visuals span")) as HTMLElement[];
  if (bgSpans.length === 0) return;

  // Store original positions for parallax
  const originalPositions = bgSpans.map((span) => {
    const rect = span.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });

  let mouseX = -500;
  let mouseY = -500;
  let smoothX = -500;
  let smoothY = -500;
  const PARALLAX_LERP_BASE = 0.25; // lerp factor calibrated at 60fps
  let prevParallaxTimestamp = 0;
  let isWide = window.innerWidth > MOBILE_BREAKPOINT;
  let dirty = false; // only start writing once the mouse has actually moved

  window.addEventListener("resize", () => {
    isWide = window.innerWidth > MOBILE_BREAKPOINT;
  });

  function updateParallax(timestamp: number) {
    const dt = prevParallaxTimestamp === 0 ? 1000 / 60 : timestamp - prevParallaxTimestamp;
    prevParallaxTimestamp = timestamp;
    const factor = 1 - Math.pow(1 - PARALLAX_LERP_BASE, dt / (1000 / 60));

    smoothX += (mouseX - smoothX) * factor;
    smoothY += (mouseY - smoothY) * factor;

    // Only write to DOM when mouse has moved or smoothing hasn't converged
    if (dirty && isWide) {
      bgSpans.forEach((span, i) => {
        const pos = originalPositions[i];
        const dx = smoothX - pos.x;
        const dy = smoothY - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const strength = Math.max(0, 1 - dist / PARALLAX_MAX_DIST) * PARALLAX_STRENGTH;
        const offsetX = (dx / (dist || 1)) * strength;
        const offsetY = (dy / (dist || 1)) * strength;
        span.style.translate = `${offsetX}px ${offsetY}px`;
      });

      // Stop writing once smoothing has converged
      if (Math.abs(mouseX - smoothX) < 0.05 && Math.abs(mouseY - smoothY) < 0.05) {
        smoothX = mouseX;
        smoothY = mouseY;
        dirty = false;
      }
    }

    requestAnimationFrame(updateParallax);
  }

  requestAnimationFrame(updateParallax);

  document.addEventListener("mousemove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    dirty = true;
  });
}
