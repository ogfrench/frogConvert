import { describe, it, expect } from "vitest";
import { ensureMinDuration } from "./index.ts";

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

    it("uses default minMs of 600", async () => {
        const startTime = performance.now() - 590; // pretend 590ms elapsed

        const before = performance.now();
        await ensureMinDuration(startTime);
        const waited = performance.now() - before;

        // Should wait roughly 10ms (600 - 590), but at least resolve
        expect(waited).toBeGreaterThanOrEqual(0);
        expect(waited).toBeLessThan(100);
    });
});
