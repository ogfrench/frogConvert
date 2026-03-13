import { expect, test, describe, vi, beforeEach } from "vitest";
import { triggerConfetti } from "./Confetti";

describe("Confetti Component", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    test("creates and eventually removes a canvas element", () => {
        vi.useFakeTimers();
        triggerConfetti();
        expect(document.getElementById("confetti-canvas")).not.toBeNull();

        vi.advanceTimersByTime(4000);
        for (let i = 0; i < 10; i++) vi.advanceTimersByTime(16);

        expect(document.getElementById("confetti-canvas")).toBeNull();
    });
});
