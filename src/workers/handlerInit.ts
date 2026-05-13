import type { FormatHandler } from "../core/FormatHandler/FormatHandler.ts";

const inFlight = new WeakMap<FormatHandler, Promise<void>>();

/**
 * Drives FormatHandler.init() exactly once per handler under concurrent callers.
 * If init throws, the cached promise is dropped so a later caller can retry.
 */
export async function ensureHandlerInit(handler: FormatHandler): Promise<void> {
  if (handler.ready) return;
  let p = inFlight.get(handler);
  if (!p) {
    p = (async () => {
      try {
        await handler.init();
      } catch (e) {
        inFlight.delete(handler);
        throw e;
      }
    })();
    inFlight.set(handler, p);
  }
  return p;
}
