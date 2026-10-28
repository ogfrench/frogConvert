import "./Toast.css";
import { Icons } from "../icons.ts";

type Variant = "info" | "warn" | "error";

let el: HTMLDivElement | null = null;
let textNode: HTMLSpanElement | null = null;
let iconNode: HTMLSpanElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let hideAt = 0;
let remainingMs = 0;

function ensureEl(): HTMLDivElement {
  if (el) return el;
  const d = document.createElement("div");
  d.className = "toast";
  d.setAttribute("role", "status");
  d.setAttribute("aria-live", "polite");

  const iconSpan = document.createElement("span");
  iconSpan.className = "toast-icon";
  iconSpan.setAttribute("aria-hidden", "true");
  d.appendChild(iconSpan);
  iconNode = iconSpan;

  const textSpan = document.createElement("span");
  textSpan.className = "toast-text";
  d.appendChild(textSpan);
  textNode = textSpan;

  // Real close button so SR + keyboard users have a discoverable dismiss path
  // (the original full-toast click-to-dismiss had no announced affordance).
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "toast-dismiss";
  closeBtn.setAttribute("aria-label", "Dismiss");
  closeBtn.innerHTML = Icons.x();
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dismiss();
  });
  d.appendChild(closeBtn);

  // Click-to-dismiss on the toast body kept for backwards compat.
  d.addEventListener("click", dismiss);
  d.addEventListener("mouseenter", pauseDismissal);
  d.addEventListener("mouseleave", resumeDismissal);
  d.addEventListener("focusin", pauseDismissal);
  d.addEventListener("focusout", (event) => {
    if (!d.contains(event.relatedTarget as Node | null)) resumeDismissal();
  });

  document.body.appendChild(d);
  el = d;
  return d;
}

/** Close any visible toast, e.g. when a modal now says the same thing in place. */
export function dismissToast(): void {
  dismiss();
}

function stopTimer(): void {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
}

function dismiss(): void {
  if (!el) return;
  el.classList.remove("open");
  stopTimer();
  remainingMs = 0;
}

function scheduleDismissal(ms: number): void {
  stopTimer();
  remainingMs = ms;
  if (ms <= 0) return;
  hideAt = Date.now() + ms;
  hideTimer = setTimeout(dismiss, ms);
}

function pauseDismissal(): void {
  if (!hideTimer) return;
  remainingMs = Math.max(1, hideAt - Date.now());
  stopTimer();
}

function resumeDismissal(): void {
  if (el?.classList.contains("open") && remainingMs > 0 && !hideTimer) {
    scheduleDismissal(remainingMs);
  }
}

export function showToast(message: string, variant: Variant = "info", durationMs = variant === "error" ? 0 : 6000): void {
  const node = ensureEl();
  // An informational update must not overwrite an error awaiting dismissal.
  if (node.classList.contains("open") && node.classList.contains("variant-error") && variant !== "error") return;
  node.classList.remove("variant-info", "variant-warn", "variant-error");
  node.classList.add(`variant-${variant}`);
  const urgent = variant === "error";
  node.setAttribute("role", urgent ? "alert" : "status");
  node.setAttribute("aria-live", urgent ? "assertive" : "polite");
  if (iconNode) iconNode.innerHTML = variant === "warn" ? Icons.alertTriangle()
    : variant === "error" ? Icons.circleAlert() : Icons.info();
  if (textNode) textNode.textContent = message;
  stopTimer();
  void node.offsetWidth;
  node.classList.add("open");
  scheduleDismissal(durationMs);
}
