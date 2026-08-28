import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  claimReloadAttempt,
  isStaleChunkFailure,
  isShellCache,
  RELOAD_MARKER,
  RELOAD_COOLDOWN_MS,
  BOOT_FLAG,
  type ReloadGuardStorage,
} from "./staleShell";

function memoryStorage(seed: Record<string, string> = {}): ReloadGuardStorage {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
  };
}

describe("claimReloadAttempt", () => {
  it("allows the first attempt and records it", () => {
    const storage = memoryStorage();
    expect(claimReloadAttempt(storage, 1_000_000)).toBe(true);
    expect(storage.getItem(RELOAD_MARKER)).toBe("1000000");
  });

  it("refuses a second attempt inside the cooldown", () => {
    const storage = memoryStorage();
    expect(claimReloadAttempt(storage, 1_000_000)).toBe(true);
    expect(claimReloadAttempt(storage, 1_000_000 + RELOAD_COOLDOWN_MS - 1)).toBe(false);
  });

  it("allows another attempt once the cooldown has passed", () => {
    // A tab left open across two deploys must still be able to recover.
    const storage = memoryStorage();
    expect(claimReloadAttempt(storage, 1_000_000)).toBe(true);
    expect(claimReloadAttempt(storage, 1_000_000 + RELOAD_COOLDOWN_MS + 1)).toBe(true);
  });

  it("refuses when there is no storage at all", () => {
    expect(claimReloadAttempt(undefined)).toBe(false);
  });

  it("refuses when storage throws, rather than looping unguarded", () => {
    const hostile: ReloadGuardStorage = {
      getItem() { throw new Error("SecurityError"); },
      setItem() { throw new Error("SecurityError"); },
    };
    expect(claimReloadAttempt(hostile)).toBe(false);
  });

  it("ignores a corrupt marker and allows the attempt", () => {
    const storage = memoryStorage({ [RELOAD_MARKER]: "not-a-number" });
    expect(claimReloadAttempt(storage, 1_000_000)).toBe(true);
  });
});

describe("isStaleChunkFailure", () => {
  it.each([
    "Failed to fetch dynamically imported module: /assets/pdf-Bl-Serqq.js",
    "error loading dynamically imported module",
    "Importing a module script failed.",
    'Expected a JavaScript module script but the server responded with a MIME type of "text/html".',
    "Unable to preload CSS for /assets/PdfWorkspace-a1b2c3d4.css",
  ])("recognises %j as a stale chunk", (message) => {
    expect(isStaleChunkFailure(new Error(message))).toBe(true);
  });

  it("does not fire when the browser reports being offline", () => {
    // Reloading cannot fix an absent network, and would only lose the page.
    const err = new Error("Failed to fetch dynamically imported module: /assets/x.js");
    expect(isStaleChunkFailure(err, false)).toBe(false);
  });

  it("leaves an ordinary application error alone", () => {
    expect(isStaleChunkFailure(new Error("no decode delegate for this image format"))).toBe(false);
  });

  it("handles a null or empty reason without throwing", () => {
    expect(isStaleChunkFailure(null)).toBe(false);
    expect(isStaleChunkFailure(undefined)).toBe(false);
    expect(isStaleChunkFailure("")).toBe(false);
  });

  it("reads a bare string reason, not just an Error", () => {
    expect(isStaleChunkFailure("Failed to fetch dynamically imported module")).toBe(true);
  });
});

describe("isShellCache", () => {
  it.each([
    "workbox-precache-v2-https://frogconvert.xyz/",
    "assets-v1",
    "assets-v2",
    "js-runtime-v1",
    "docs-md-v1",
  ])("purges %j, which can hold a stale or poisoned shell", (name) => {
    expect(isShellCache(name)).toBe(true);
  });

  it("spares wasm-v1", () => {
    // ~17 MB of engines at content-stable URLs no deploy invalidates. Deleting
    // them for a hashed-asset problem is pure cost to the user.
    expect(isShellCache("wasm-v1")).toBe(false);
  });

  it("spares the share-target cache", () => {
    // It may hold the files a share is mid-way through handing to the app;
    // clearing it turns a recoverable reload into a share that does nothing.
    expect(isShellCache("share-target-files-v1")).toBe(false);
  });
});

describe("the inline boot recovery script", () => {
  const boot = readFileSync(resolve(__dirname, "bootRecovery.js"), "utf8");

  it("uses the same sessionStorage key as this module", () => {
    // Two implementations of one guard - the inline copy exists because it must
    // run when no module has loaded. If the keys drift apart each can reload
    // once, defeating the loop guard.
    expect(boot).toContain(`var MARKER = "${RELOAD_MARKER}";`);
  });

  it("uses the same cooldown as this module", () => {
    expect(boot).toContain(`var COOLDOWN_MS = ${RELOAD_COOLDOWN_MS};`);
  });

  it("checks the same boot flag this module sets", () => {
    expect(boot).toContain(`window.${BOOT_FLAG}`);
  });

  it("bails once the app has booted, leaving lazy chunks to this module", () => {
    // Without this the listener stays armed all session: a transient failure on
    // one of Vite's modulepreload links would purge caches and reload
    // mid-conversion, losing queued files.
    expect(boot).toMatch(/if \(window\.__frogShellBooted\) return;/);
  });

  it("purges exactly the caches isShellCache selects", () => {
    // Same divergence risk as the marker: the inline copy cannot import.
    const inlined = [...boot.matchAll(/name === "([^"]+)"/g)].map((m) => m[1]);
    expect(inlined.sort()).toEqual(
      ["assets-v1", "assets-v2", "js-runtime-v1", "docs-md-v1"].sort()
    );
    expect(boot).toContain('name.indexOf("workbox-precache") === 0');
    for (const name of inlined) expect(isShellCache(name)).toBe(true);
  });

  it("listens for asset load errors in the capture phase", () => {
    // Resource load errors do not bubble; a non-capturing listener never sees
    // them and the whole recovery silently does nothing.
    expect(boot).toMatch(/addEventListener\("error",[\s\S]*?\}, true\);/);
  });

  it("does not clear localStorage while recovering", () => {
    expect(boot).not.toMatch(/localStorage\.clear\(\)/);
  });
});
