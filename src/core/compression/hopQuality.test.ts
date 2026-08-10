import { describe, it, expect } from "vitest";
import { qualityForHop } from "./hopQuality.ts";
import type { FileFormat } from "../FormatHandler/FormatHandler.ts";

const fmt = (lossless = false) => ({ mime: "image/x", format: "x", lossless } as unknown as FileFormat);

describe("qualityForHop", () => {
    it("applies the requested quality to the hop that produces the kept file", () => {
        expect(qualityForHop({ target: fmt(), isLastHop: true, requested: "low" })).toBe("low");
        expect(qualityForHop({ target: fmt(), isLastHop: true, requested: "medium" })).toBe("medium");
    });

    it("runs intermediates gently so loss doesn't compound", () => {
        // The whole point: a mid-route hop must not re-apply the target
        // reduction, or a 3-hop route compresses three times over.
        expect(qualityForHop({ target: fmt(), isLastHop: false, requested: "low" })).toBe("high");
        expect(qualityForHop({ target: fmt(), isLastHop: false, requested: "medium" })).toBe("high");
    });

    it("honours 'no compression' end to end, not just at the end", () => {
        expect(qualityForHop({ target: fmt(), isLastHop: false, requested: "lossless" })).toBe("lossless");
        expect(qualityForHop({ target: fmt(), isLastHop: true, requested: "lossless" })).toBe("lossless");
    });

    it("opts out for a lossless target wherever it appears", () => {
        expect(qualityForHop({ target: fmt(true), isLastHop: true, requested: "low" })).toBe("lossless");
        expect(qualityForHop({ target: fmt(true), isLastHop: false, requested: "low" })).toBe("lossless");
    });

    it("never compresses an intermediate harder than the final output", () => {
        // Guards the regression the agent surfaces had: target quality applied
        // at every step.
        const order: Record<string, number> = { lossless: 0, high: 1, medium: 2, low: 3 };
        for (const requested of ["lossless", "high", "medium", "low"] as const) {
            const mid = qualityForHop({ target: fmt(), isLastHop: false, requested });
            const last = qualityForHop({ target: fmt(), isLastHop: true, requested });
            expect(order[mid]).toBeLessThanOrEqual(order[last]);
        }
    });
});
