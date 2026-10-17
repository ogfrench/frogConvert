const mql = typeof window !== "undefined" && typeof window.matchMedia === "function"
  ? window.matchMedia("(pointer: coarse)")
  : null;

export function isTouchUi(): boolean {
  return mql ? mql.matches : false;
}
