import { describe, it, expect } from "vitest";
import { tierDown } from "./tierDown.ts";

describe("tierDown", () => {
    it("uncompressed → high", () => {
        expect(tierDown("uncompressed")).toEqual({ kind: "compress", tier: "high" });
    });

    it("hq → medium", () => {
        expect(tierDown("hq")).toEqual({ kind: "compress", tier: "medium" });
    });

    it("medium → low", () => {
        expect(tierDown("medium")).toEqual({ kind: "compress", tier: "low" });
    });

    it("low stays at low (cannot step down further without going minimal)", () => {
        expect(tierDown("low")).toEqual({ kind: "compress", tier: "low" });
    });

    it("minimal skips (return original)", () => {
        expect(tierDown("minimal")).toEqual({ kind: "skip", reason: "already-minimal" });
    });

    describe("PDF", () => {
        const PDF = "application/pdf";

        // A lower Ghostscript preset can grow a PDF rather than shrink it, so
        // stepping down is unsafe here in a way it is not for a raster image.
        it("aims at high whatever the input tier, because lower presets can inflate", () => {
            for (const tier of ["uncompressed", "hq", "medium", "low"] as const) {
                expect(tierDown(tier, PDF)).toEqual({ kind: "compress", tier: "high" });
            }
        });

        it("still skips a genuinely minimal PDF rather than promoting it to high", () => {
            expect(tierDown("minimal", PDF)).toEqual({ kind: "skip", reason: "already-minimal" });
        });

        it("leaves every other mime on the normal ladder", () => {
            expect(tierDown("medium", "image/jpeg")).toEqual({ kind: "compress", tier: "low" });
            expect(tierDown("hq", "video/mp4")).toEqual({ kind: "compress", tier: "medium" });
        });
    });
});
