import "./CustomCursor.css";

export function initCustomCursor() {
    if (window.matchMedia("(pointer: coarse)").matches) return;

    const cursor = document.createElement("div");
    cursor.id = "custom-cursor";
    document.body.appendChild(cursor);

    let mouseX = -100;
    let mouseY = -100;
    let cursorX = -100;
    let cursorY = -100;

    document.addEventListener("mousemove", (mouseEvent) => {
        mouseX = mouseEvent.clientX;
        mouseY = mouseEvent.clientY;

        const hoveredElement = mouseEvent.target as HTMLElement;
        const isInteractive = hoveredElement.closest("a, button, input, select, label, .clickable, .cat-tab, #upload-zone");

        if (isInteractive) {
            cursor.classList.add("interactive");
        } else {
            cursor.classList.remove("interactive");
        }
    });

    document.addEventListener("mousedown", () => {
        cursor.classList.add("active-click");
    });

    document.addEventListener("mouseup", () => {
        cursor.classList.remove("active-click");
    });

    function renderCursor() {
        cursorX += (mouseX - cursorX) * 0.2;
        cursorY += (mouseY - cursorY) * 0.2;
        cursor.style.left = `${cursorX}px`;
        cursor.style.top = `${cursorY}px`;
        requestAnimationFrame(renderCursor);
    }

    requestAnimationFrame(renderCursor);
}
