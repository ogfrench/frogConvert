import { expect, test, describe, vi, beforeEach } from "vitest";
import { triggerConfetti } from "./Confetti";

describe("Confetti Component", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    test("creates canvas element on trigger", () => {
        vi.useFakeTimers();
        triggerConfetti();
        const canvas = document.getElementById("confetti-canvas");
        expect(canvas).not.toBeNull();
        vi.useRealTimers();
    });

    test("removes canvas after completion", async () => {
        vi.useFakeTimers();
        triggerConfetti();
        expect(document.getElementById("confetti-canvas")).not.toBeNull();

        // Advance time past the 2.5s duration
        await vi.advanceTimersByTimeAsync(3000);

        // Ensure the loop finishes
        for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(16);

        expect(document.getElementById("confetti-canvas")).toBeNull();
    });

    test("handles delayed first frame (the fix)", async () => {
        vi.useFakeTimers();

        // We want to trigger at t=0, but simulate the first frame hitting at t=5000
        vi.setSystemTime(0);
        triggerConfetti();

        // Jump to t=5000 without running timers yet
        vi.setSystemTime(5000);

        // Now let one frame run. It should use the current time (5000) as startTime.
        await vi.advanceTimersByTimeAsync(16);

        // It should STILL be there
        expect(document.getElementById("confetti-canvas")).not.toBeNull();

        // Advance another 1s. Total time 6s. Elapsed from startTime (5000) is 1s.
        await vi.advanceTimersByTimeAsync(1000);
        expect(document.getElementById("confetti-canvas")).not.toBeNull();

        // Advance to end (5000 + 2500 + buffer)
        await vi.advanceTimersByTimeAsync(2000);
        for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(16);

        expect(document.getElementById("confetti-canvas")).toBeNull();
    });
});
