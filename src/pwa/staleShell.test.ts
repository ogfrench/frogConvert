import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  claimReloadAttempt,
  isStaleChunkFailure,
  RELOAD_MARKER,
  RELOAD_COOLDOWN_MS,
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

describe("the inline boot recovery in index.html", () => {
  const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");

  it("uses the same sessionStorage key as this module", () => {
    // They are two implementations of one guard - the inline copy exists
    // because it must run when no module has loaded. If the keys drift apart
    // each can reload once, defeating the loop guard.
    expect(html).toContain(`var _RELOAD_MARKER = "${RELOAD_MARKER}";`);
  });

  it("uses the same cooldown as this module", () => {
    expect(html).toContain(`var _RELOAD_COOLDOWN_MS = ${RELOAD_COOLDOWN_MS};`);
  });

  it("listens for asset load errors in the capture phase", () => {
    // Resource load errors do not bubble; a non-capturing listener never sees
    // them and the whole recovery silently does nothing.
    expect(html).toMatch(/addEventListener\("error",[\s\S]*?\}, true\);/);
  });

  it("does not clear localStorage while recovering", () => {
    // The format registry, theme and persisted session live there and are not
    // implicated in a shell/chunk mismatch.
    expect(html).not.toMatch(/localStorage\.clear\(\)/);
  });
});
