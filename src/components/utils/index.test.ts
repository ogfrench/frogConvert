import { describe, it, expect } from "vitest";
import { ensureMinDuration, toUserErrorInfo } from "./index.ts";

describe("ensureMinDuration", () => {
    it("waits if the elapsed time is less than the minimum duration", async () => {
        const startTime = performance.now();
        const minMs = 100; // short for fast tests

        // Should take at least ~100ms to resolve
        await ensureMinDuration(startTime, minMs);
        const elapsed = performance.now() - startTime;

        expect(elapsed).toBeGreaterThanOrEqual(90); // allow small timing jitter
    });

    it("does not wait if the elapsed time is greater than the minimum duration", async () => {
        const minMs = 50;
        const startTime = performance.now() - 100; // pretend 100ms already elapsed

        const before = performance.now();
        await ensureMinDuration(startTime, minMs);
        const waited = performance.now() - before;

        // Should resolve almost immediately (under 50ms)
        expect(waited).toBeLessThan(50);
    });

    it("uses default minMs of 1200", async () => {
        const startTime = performance.now() - 1190; // pretend 1190ms elapsed

        const before = performance.now();
        await ensureMinDuration(startTime);
        const waited = performance.now() - before;

        // Should wait roughly 10ms (1200 - 1190), but at least resolve
        expect(waited).toBeGreaterThanOrEqual(0);
        expect(waited).toBeLessThan(100);
    });
});

describe("a converter that could not be downloaded", () => {
    // Reported on a real EPS -> PDF over a weak connection. Ghostscript is a
    // one-time ~16 MB fetch, and a dropped download was diagnosed as "unknown",
    // which renders as "didn't complete this time - try a different target
    // format or another file". Neither can help, and both point at the file.
    it.each([
        "TypeError: Failed to fetch",
        "NetworkError when attempting to fetch resource.",
        "Load failed",
        "Failed to fetch dynamically imported module: /wasm/gs/gs.mjs",
        "Couldn't fetch the converter (503)",
        "net::ERR_CONNECTION_RESET",
    ])("recognises %j as the download, not the file", (raw) => {
        const info = toUserErrorInfo(new Error(raw));
        expect(info.kind).toBe("engine_download");
        expect(info.message).toMatch(/couldn't finish downloading/i);
        expect(info.message).toMatch(/your file is fine/i);
    });

    it("wins over the Ghostscript rule, which the same text also matches", () => {
        // "Couldn't fetch the converter" would otherwise be read as a format
        // we do not support.
        expect(toUserErrorInfo(new Error("Couldn't fetch the converter (0)")).kind)
            .toBe("engine_download");
    });

    it("leaves a genuine capability gap alone", () => {
        expect(toUserErrorInfo(new Error("no decode delegate for this image format")).kind)
            .toBe("not_available");
    });
});
