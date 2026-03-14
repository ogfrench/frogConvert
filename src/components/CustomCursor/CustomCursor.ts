import "./CustomCursor.css";

export function initCustomCursor() {
    if (window.matchMedia("(pointer: coarse)").matches) return;

    const cursor = document.createElement("div");
    cursor.id = "custom-cursor";

    const glow = document.createElement("div");
    glow.className = "cursor-glow";
    cursor.appendChild(glow);

    document.documentElement.classList.add("custom-cursor-active");
    document.body.appendChild(cursor);

    let mouseX = -100;
    let mouseY = -100;
    let cursorX = -100;
    let cursorY = -100;

    let lastHoverCheck = 0;
    const HOVER_CHECK_INTERVAL = 100; // ms

    document.addEventListener("mousemove", (mouseEvent) => {
        mouseX = mouseEvent.clientX;
        mouseY = mouseEvent.clientY;

        const now = Date.now();
        if (now - lastHoverCheck > HOVER_CHECK_INTERVAL) {
            const hoveredElement = mouseEvent.target as HTMLElement;
            const isInteractive = hoveredElement.closest("a, button, input, select, label, .clickable, .cat-tab, #upload-zone");

            if (isInteractive) {
                cursor.classList.add("interactive");
            } else {
                cursor.classList.remove("interactive");
            }
            lastHoverCheck = now;
        }
    });

    document.addEventListener("mousedown", () => {
        cursor.classList.add("active-click");
    });

    document.addEventListener("mouseup", () => {
        cursor.classList.remove("active-click");
    });

    const CURSOR_LERP_BASE = 0.2; // lerp factor calibrated at 60fps
    let prevCursorTimestamp = 0;

    function renderCursor(timestamp: number) {
        const dt = prevCursorTimestamp === 0 ? 1000 / 60 : timestamp - prevCursorTimestamp;
        prevCursorTimestamp = timestamp;
        const factor = 1 - Math.pow(1 - CURSOR_LERP_BASE, dt / (1000 / 60));

        cursorX += (mouseX - cursorX) * factor;
        cursorY += (mouseY - cursorY) * factor;

        cursor.style.transform = `translate3d(${cursorX}px, ${cursorY}px, 0) translate(-50%, -50%)`;
        requestAnimationFrame(renderCursor);
    }

    requestAnimationFrame(renderCursor);
}
