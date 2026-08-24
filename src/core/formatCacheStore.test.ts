import { describe, it, expect, vi } from "vitest";
import { readFormatCache, writeFormatCache, FORMAT_CACHE_KEY, type FormatCacheEntries } from "./formatCacheStore.ts";

/** Minimal in-memory Storage. Optionally throws, to model quota/disabled. */
function makeStorage(initial: Record<string, string> = {}, throwOn?: "get" | "set" | "remove"): Storage {
  const map = new Map(Object.entries(initial));
  return {
    getItem(k: string) {
      if (throwOn === "get") throw new Error("blocked");
      return map.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      if (throwOn === "set") throw new Error("QuotaExceededError");
      map.set(k, v);
    },
    removeItem(k: string) {
      if (throwOn === "remove") throw new Error("blocked");
      map.delete(k);
    },
    clear() { map.clear(); },
    key(i: number) { return [...map.keys()][i] ?? null; },
    get length() { return map.size; },
  } as Storage;
}

const entries = [["ImageMagick", []]] as unknown as FormatCacheEntries;

describe("readFormatCache", () => {
  it("returns entries written by the same build", () => {
    const s = makeStorage();
    writeFormatCache(s, "abc123", entries);
    expect(readFormatCache(s, "abc123")).toEqual(entries);
  });

  it("rejects and clears a cache from a different build", () => {
    const s = makeStorage();
    writeFormatCache(s, "old-sha", entries);
    expect(readFormatCache(s, "new-sha")).toBeNull();
    // Cleared, so the rejection happens once rather than on every load.
    expect(s.getItem(FORMAT_CACHE_KEY)).toBeNull();
  });

  it("rejects the legacy unversioned shape (a bare array)", () => {
    // What shipped before this module existed. Returning users hold exactly
    // this, and it is the whole reason they were stuck on an old format list.
    const s = makeStorage({ [FORMAT_CACHE_KEY]: JSON.stringify([["ImageMagick", []]]) });
    expect(readFormatCache(s, "abc123")).toBeNull();
    expect(s.getItem(FORMAT_CACHE_KEY)).toBeNull();
  });

  it("returns null when absent", () => {
    expect(readFormatCache(makeStorage(), "abc123")).toBeNull();
  });

  it("rejects and clears unparseable JSON", () => {
    const s = makeStorage({ [FORMAT_CACHE_KEY]: "{not json" });
    expect(readFormatCache(s, "abc123")).toBeNull();
    expect(s.getItem(FORMAT_CACHE_KEY)).toBeNull();
  });

  it("rejects a versioned blob whose entries are not an array", () => {
    const s = makeStorage({ [FORMAT_CACHE_KEY]: JSON.stringify({ version: "abc123", entries: {} }) });
    expect(readFormatCache(s, "abc123")).toBeNull();
  });

  it("returns null rather than throwing when storage is blocked", () => {
    expect(readFormatCache(makeStorage({}, "get"), "abc123")).toBeNull();
  });

  it("survives a storage that cannot be cleared", () => {
    const s = makeStorage({ [FORMAT_CACHE_KEY]: "{not json" }, "remove");
    expect(() => readFormatCache(s, "abc123")).not.toThrow();
    expect(readFormatCache(s, "abc123")).toBeNull();
  });
});

describe("writeFormatCache", () => {
  it("reports success and round-trips", () => {
    const s = makeStorage();
    expect(writeFormatCache(s, "abc123", entries)).toBe(true);
    expect(readFormatCache(s, "abc123")).toEqual(entries);
  });

  it("swallows QuotaExceededError and reports failure", () => {
    // This runs on the Phase-2 load path; an uncaught throw here used to take
    // the rest of the load down with it.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(writeFormatCache(makeStorage({}, "set"), "abc123", entries)).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
