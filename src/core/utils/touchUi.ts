const mql = typeof window !== "undefined" && typeof window.matchMedia === "function"
  ? window.matchMedia("(pointer: coarse)")
  : null;

const listeners = new Set<(isTouch: boolean) => void>();

if (mql) {
  mql.addEventListener("change", (ev) => {
    for (const cb of listeners) cb(ev.matches);
  });
}

export function isTouchUi(): boolean {
  return mql ? mql.matches : false;
}

export function subscribeTouchUi(cb: (isTouch: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
