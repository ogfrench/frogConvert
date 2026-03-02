import { expect, test, describe } from "vitest";
import { triggerConfetti } from "./Confetti";

describe("Confetti Component", () => {
    test("creates canvas element on first trigger", () => {
        // Ensure body doesn't have it yet
        let canvas = document.getElementById("confetti-canvas");
        expect(canvas).toBeNull();

        // Call trigger
        triggerConfetti();

        // Confetti canvas should now be appended to the body
        canvas = document.getElementById("confetti-canvas");
        expect(canvas).not.toBeNull();
        expect(canvas?.style.position).toBe("fixed");
        expect(canvas?.style.pointerEvents).toBe("none");
    });
});
