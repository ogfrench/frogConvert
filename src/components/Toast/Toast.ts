import "./Toast.css";

type Variant = "info" | "warn" | "error";

let el: HTMLDivElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function ensureEl(): HTMLDivElement {
  if (el) return el;
  const d = document.createElement("div");
  d.className = "toast";
  d.setAttribute("role", "status");
  d.setAttribute("aria-live", "polite");
  d.addEventListener("click", dismiss);
  document.body.appendChild(d);
  el = d;
  return d;
}

function dismiss(): void {
  if (!el) return;
  el.classList.remove("open");
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

export function showToast(message: string, variant: Variant = "info", durationMs = 6000): void {
  const node = ensureEl();
  node.classList.remove("variant-info", "variant-warn", "variant-error");
  node.classList.add(`variant-${variant}`);
  node.textContent = message;
  if (hideTimer) clearTimeout(hideTimer);
  // Force reflow so the opacity/translate transition restarts when replacing a visible message.
  void node.offsetWidth;
  node.classList.add("open");
  hideTimer = setTimeout(() => {
    node.classList.remove("open");
    hideTimer = null;
  }, durationMs);
}
