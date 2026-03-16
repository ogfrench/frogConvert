import { expect, test, describe, vi, beforeEach } from "vitest";
import { triggerConfetti } from "./Confetti";

describe("Confetti Component", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    test("creates a canvas element on trigger", () => {
        vi.useFakeTimers();
        triggerConfetti();
        expect(document.getElementById("confetti-canvas")).not.toBeNull();
    });
});
