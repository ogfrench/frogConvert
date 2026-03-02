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
  const LERP_FACTOR = 0.25;

  function updateParallax() {
    smoothX += (mouseX - smoothX) * LERP_FACTOR;
    smoothY += (mouseY - smoothY) * LERP_FACTOR;

    // Parallax on background elements
    if (window.innerWidth > MOBILE_BREAKPOINT) {
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
    }

    requestAnimationFrame(updateParallax);
  }

  requestAnimationFrame(updateParallax);

  document.addEventListener("mousemove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });
}
