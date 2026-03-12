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

    test("removes canvas after completion", () => {
        vi.useFakeTimers();
        triggerConfetti();
        expect(document.getElementById("confetti-canvas")).not.toBeNull();

        // Advance time past the 3.5s duration (first rAF fires at ~16ms, so startTime≈16)
        vi.advanceTimersByTime(4000);

        // Ensure the final rAF frame fires and removes the canvas
        for (let i = 0; i < 10; i++) vi.advanceTimersByTime(16);

        expect(document.getElementById("confetti-canvas")).toBeNull();
    });

    test("handles delayed first frame (the fix)", () => {
        vi.useFakeTimers();

        // We want to trigger at t=0, but simulate the first frame hitting at t=5000
        vi.setSystemTime(0);
        triggerConfetti();

        // Jump to t=5000 without running timers yet
        vi.setSystemTime(5000);

        // Now let one frame run. It should use the current time (5000) as startTime.
        vi.advanceTimersByTime(16);

        // It should STILL be there
        expect(document.getElementById("confetti-canvas")).not.toBeNull();

        // Advance another 1s. Total time 6s. Elapsed from startTime (5000) is 1s.
        vi.advanceTimersByTime(1000);
        expect(document.getElementById("confetti-canvas")).not.toBeNull();

        // Advance to end (startTime≈5016, need elapsed≥3500 → now≥8516; advance 3000 more to reach ~9016)
        vi.advanceTimersByTime(3000);
        for (let i = 0; i < 10; i++) vi.advanceTimersByTime(16);

        expect(document.getElementById("confetti-canvas")).toBeNull();
    });
});
