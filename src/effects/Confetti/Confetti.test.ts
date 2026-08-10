import { expect, test, describe, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { triggerConfetti, celebrateOnPopup } from "./Confetti";

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

describe("celebrateOnPopup", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    function openPopup(open: boolean): HTMLElement {
        const el = document.createElement("div");
        if (open) el.classList.add("open");
        document.body.appendChild(el);
        return el;
    }

    test("celebrates once the beat has passed", () => {
        vi.useFakeTimers();
        celebrateOnPopup(openPopup(true));
        expect(document.getElementById("confetti-canvas")).toBeNull();
        vi.advanceTimersByTime(150);
        expect(document.getElementById("confetti-canvas")).not.toBeNull();
    });

    test("stays quiet if the popup was dismissed inside the beat", () => {
        vi.useFakeTimers();
        const popup = openPopup(true);
        celebrateOnPopup(popup);
        popup.classList.remove("open");
        vi.advanceTimersByTime(150);
        expect(document.getElementById("confetti-canvas")).toBeNull();
    });

    test("does nothing at all when there is no popup to anchor to", () => {
        vi.useFakeTimers();
        expect(() => celebrateOnPopup(null)).not.toThrow();
        vi.advanceTimersByTime(150);
        expect(document.getElementById("confetti-canvas")).toBeNull();
    });

    test("is the only way the success paths celebrate", () => {
        // Three surfaces had their own copy of this timer and all three read a
        // global inside it. Deduplicating them is what fixed the flake, so a
        // fourth copy would reinstate it - and it would pass every test and
        // only fail later, in CI, on someone else's branch.
        for (const file of [
            "../../conversion/actions.ts",
            "../../components/PdfWorkspace/PdfWorkspace.ts",
            "../../components/CompressWorkspace/CompressWorkspace.ts",
        ]) {
            const src = readFileSync(resolve(__dirname, file), "utf8");
            expect(src, file).toMatch(/celebrateOnPopup\(/);
            expect(src, file).not.toMatch(/triggerConfetti\(/);
        }
    });

    test("survives the document going away before the beat lands", () => {
        // The regression this helper exists for. The three success paths used
        // to read `ui.popupBox` *inside* the timer, so the deferred callback
        // reached for a global 150ms after the fact. Under load in CI that
        // landed after the environment had been torn down and took a run with
        // 1,110 passing tests red with an uncaught ReferenceError.
        //
        // Holding the element instead means the callback dereferences nothing
        // global, and the one function that genuinely needs a document checks
        // for one first.
        vi.useFakeTimers();
        celebrateOnPopup(openPopup(true));
        vi.stubGlobal("document", undefined);
        expect(() => vi.advanceTimersByTime(150)).not.toThrow();
    });
});
