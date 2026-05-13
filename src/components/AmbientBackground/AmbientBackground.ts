import { PARALLAX_MAX_DIST, PARALLAX_STRENGTH } from "../../constants/ui.ts";
import { isTouchUi } from "../../core/utils/touchUi.ts";

// --- Ambient Visuals ---
export function initParallax() {
  // Don't init on touch devices
  if (isTouchUi()) return;
  // Honor system reduced-motion preference. The CSS gate caps animation/
  // transition durations but doesn't catch this loop's inline-style writes,
  // so we short-circuit at the JS level.
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

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
  // Proximity unblur tuning. Matches the original :hover values (blur 0,
  // opacity ~0.45–0.6) at the cursor and the rest tokens far from it.
  const CORE_RADIUS = 60;   // px around cursor that are fully clear (blur 0)
  const HALO_RADIUS = 180;  // px around cursor where the clear-up ramps in
  const REST_BLUR = 12;     // mirrors --blur-bg-visual
  const REST_OPACITY = 0.22; // mirrors --opacity-bg-visual
  const HOVER_OPACITY = 0.6;
  let prevParallaxTimestamp = 0;
  let dirty = false; // only start writing once the mouse has actually moved

  function updateParallax(timestamp: number) {
    const dt = prevParallaxTimestamp === 0 ? 1000 / 60 : timestamp - prevParallaxTimestamp;
    prevParallaxTimestamp = timestamp;
    const factor = 1 - Math.pow(1 - PARALLAX_LERP_BASE, dt / (1000 / 60));

    smoothX += (mouseX - smoothX) * factor;
    smoothY += (mouseY - smoothY) * factor;

    // Only write to DOM when mouse has moved or smoothing hasn't converged
    if (dirty) {
      bgSpans.forEach((span, i) => {
        const pos = originalPositions[i];
        const dx = smoothX - pos.x;
        const dy = smoothY - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const strength = Math.max(0, 1 - dist / PARALLAX_MAX_DIST) * PARALLAX_STRENGTH;
        const offsetX = (dx / (dist || 1)) * strength;
        const offsetY = (dy / (dist || 1)) * strength;
        span.style.translate = `${offsetX}px ${offsetY}px`;

        // Proximity unblur: spans within HALO_RADIUS of the smoothed cursor
        // sharpen and brighten. Reuses `dist` already computed for parallax.
        // Replaces the old `#bg-visuals span:hover` rule (dropped in 781f9c9
        // when spans got pointer-events:none to stop swallowing real clicks).
        const haloT = dist <= CORE_RADIUS
          ? 1
          : Math.max(0, 1 - (dist - CORE_RADIUS) / (HALO_RADIUS - CORE_RADIUS));
        span.style.filter = `blur(${REST_BLUR * (1 - haloT)}px)`;
        span.style.opacity = String(REST_OPACITY + (HOVER_OPACITY - REST_OPACITY) * haloT);
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
