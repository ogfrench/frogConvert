// Recovery from a stale app shell.
//
// Every asset URL this app loads is content-hashed, which means a deploy
// replaces the whole set. A returning user can therefore be holding HTML - from
// the service worker precache or an HTTP cache - that names chunk URLs the
// server no longer has. The import fails, and because it fails during module
// evaluation there is no running app left to report it.
//
// The precache now carries the entry chunks alongside the HTML that names them
// (see the manifestTransform in vite.config.js), so the shell itself stays
// consistent. Lazy chunks are still fetched from the network on demand, and one
// of those can still 404 against a newer deploy. That is what this module
// handles: reload once to pick up the current shell, with a guard so a genuine
// persistent failure cannot become a reload loop.

/** sessionStorage key holding the timestamp of our last self-inflicted reload. */
export const RELOAD_MARKER = "frogconvert:stale-shell-reload";

/**
 * How long a recorded reload suppresses another one. Long enough that a chunk
 * URL which is broken for some other reason cannot spin, short enough that a
 * user who leaves a tab open across two deploys still recovers on the second.
 */
export const RELOAD_COOLDOWN_MS = 5 * 60 * 1000;

export interface ReloadGuardStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Whether a recovery reload is allowed right now, recording it if so.
 *
 * Returns false when we already reloaded within the cooldown, which means the
 * reload did not fix anything and repeating it would trap the user in a loop.
 * A storage that throws (Safari private mode, storage disabled) is treated as
 * "no memory available", and we decline rather than risk looping.
 */
export function claimReloadAttempt(
  storage: ReloadGuardStorage | undefined,
  now: number = Date.now(),
): boolean {
  if (!storage) return false;
  try {
    const previous = Number(storage.getItem(RELOAD_MARKER));
    if (Number.isFinite(previous) && previous > 0 && now - previous < RELOAD_COOLDOWN_MS) {
      return false;
    }
    storage.setItem(RELOAD_MARKER, String(now));
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a failed request looks like a chunk that this deploy no longer has,
 * as opposed to the user simply being offline. Offline is not recoverable by
 * reloading and must not trigger one.
 */
export function isStaleChunkFailure(reason: unknown, online = true): boolean {
  if (!online) return false;
  const text = String(
    (reason as { message?: string } | null | undefined)?.message ?? reason ?? ""
  ).toLowerCase();
  if (!text) return false;
  return (
    text.includes("failed to fetch dynamically imported module") ||
    text.includes("error loading dynamically imported module") ||
    text.includes("importing a module script failed") ||
    // Wrong MIME type: the host answered a missing chunk with the SPA
    // fallback. The 404 rules in netlify.toml and the nginx conf are meant to
    // prevent this, but a differently-configured host will still do it.
    text.includes("expected a javascript") ||
    text.includes("mime type")
  );
}

/**
 * Drop every Cache Storage entry and unregister the service workers, so the
 * next load is served entirely from the network.
 *
 * Deliberately does NOT touch localStorage: it holds the format registry, the
 * theme and any persisted conversion session, none of which are implicated in
 * a shell/chunk mismatch and all of which are annoying to lose.
 */
export async function purgeShellCaches(): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  if (typeof caches !== "undefined") {
    jobs.push(
      caches.keys()
        .then((names) => Promise.all(names.map((name) => caches.delete(name))))
        .catch((err) => { console.warn("[pwa] cache purge failed:", err); })
    );
  }
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    jobs.push(
      navigator.serviceWorker.getRegistrations()
        .then((regs) => Promise.all(regs.map((reg) => reg.unregister())))
        .catch((err) => { console.warn("[pwa] SW unregister failed:", err); })
    );
  }
  await Promise.all(jobs);
}

/**
 * Listen for Vite's chunk-load failures and recover from the stale-shell case.
 *
 * `vite:preloadError` fires when a dynamically imported chunk cannot be
 * fetched. Calling preventDefault() marks it handled so it is not rethrown as
 * an unhandled rejection, which would otherwise put the generic error popup on
 * screen in front of a reload we are already performing.
 */
export function initStaleShellRecovery(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("vite:preloadError", (event) => {
    if (!isStaleChunkFailure(event.payload, navigator.onLine !== false)) return;

    const storage = (() => {
      try { return window.sessionStorage; } catch { return undefined; }
    })();
    if (!claimReloadAttempt(storage)) {
      console.warn("[pwa] chunk load failed again within the cooldown, not reloading");
      return;
    }

    event.preventDefault();
    console.warn("[pwa] stale chunk detected, purging caches and reloading");
    void purgeShellCaches().finally(() => location.reload());
  });
}
