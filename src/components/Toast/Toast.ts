import "./Toast.css";
import { Icons } from "../icons.ts";

type Variant = "info" | "warn" | "error";

let el: HTMLDivElement | null = null;
let textNode: HTMLSpanElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function ensureEl(): HTMLDivElement {
  if (el) return el;
  const d = document.createElement("div");
  d.className = "toast";
  d.setAttribute("role", "status");
  d.setAttribute("aria-live", "polite");

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
  // Errors should interrupt; info should yield. role swaps too so the toast
  // re-announces on each show even when reusing the same DOM node.
  if (variant === "error") {
    node.setAttribute("role", "alert");
    node.setAttribute("aria-live", "assertive");
  } else {
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
  }
  if (textNode) textNode.textContent = message;
  if (hideTimer) clearTimeout(hideTimer);
  // Force reflow so the opacity/translate transition restarts when replacing a visible message.
  void node.offsetWidth;
  node.classList.add("open");
  hideTimer = setTimeout(() => {
    node.classList.remove("open");
    hideTimer = null;
  }, durationMs);
}
