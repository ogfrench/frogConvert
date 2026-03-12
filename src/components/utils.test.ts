import { describe, it, expect, vi } from "vitest";
import { ensureMinDuration } from "./utils.ts";

describe("ensureMinDuration", () => {
    it("waits if the elapsed time is less than the minimum duration", async () => {
        vi.useFakeTimers();
        const startTime = 1000;
        const minMs = 500;

        // Mock performance.now to return 1100 (100ms elapsed)
        vi.spyOn(performance, "now").mockReturnValue(1100);

        const promise = ensureMinDuration(startTime, minMs);

        // Should not be resolved yet
        let resolved = false;
        promise.then(() => { resolved = true; });

        await vi.advanceTimersByTimeAsync(399);
        expect(resolved).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        expect(resolved).toBe(true);

        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("does not wait if the elapsed time is greater than the minimum duration", async () => {
        vi.useFakeTimers();
        const startTime = 1000;
        const minMs = 500;

        // Mock performance.now to return 1600 (600ms elapsed)
        vi.spyOn(performance, "now").mockReturnValue(1600);

        const promise = ensureMinDuration(startTime, minMs);

        // Should resolve immediately (or in the next tick)
        let resolved = false;
        promise.then(() => { resolved = true; });

        await vi.advanceTimersByTimeAsync(0);
        expect(resolved).toBe(true);

        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("uses default minMs of 600", async () => {
        vi.useFakeTimers();
        const startTime = 1000;

        // Mock performance.now to return 1100 (100ms elapsed)
        vi.spyOn(performance, "now").mockReturnValue(1100);

        const promise = ensureMinDuration(startTime);

        let resolved = false;
        promise.then(() => { resolved = true; });

        await vi.advanceTimersByTimeAsync(499);
        expect(resolved).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        expect(resolved).toBe(true);

        vi.useRealTimers();
        vi.restoreAllMocks();
    });
});
