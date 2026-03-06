import { expect, test, describe, vi } from "vitest";
import { triggerConfetti } from "./Confetti";

describe("Confetti Component", () => {
    test("creates canvas element on first trigger", () => {
        vi.stubGlobal('requestAnimationFrame', vi.fn());

        let canvas = document.getElementById("confetti-canvas");
        expect(canvas).toBeNull();

        triggerConfetti();

        canvas = document.getElementById("confetti-canvas");
        expect(canvas).not.toBeNull();
        expect(canvas?.style.position).toBe("fixed");
        expect(canvas?.style.pointerEvents).toBe("none");

        vi.unstubAllGlobals();
    });
});
