import { describe, it, expect } from "vitest";
import { tierDown } from "./tierDown.ts";

describe("tierDown", () => {
    // The ladder shifted one step gentler when the presets themselves got
    // stronger: `medium` now means q80 with a 2560px cap, so it does the work
    // that `low` used to be needed for.
    it("uncompressed → medium", () => {
        expect(tierDown("uncompressed")).toEqual({ kind: "compress", tier: "medium" });
    });

    it("hq → medium", () => {
        expect(tierDown("hq")).toEqual({ kind: "compress", tier: "medium" });
    });

    it("medium → medium, so Automatic never hands out the aggressive preset", () => {
        // An ordinary phone photo probes as "medium". Mapping it to `low` would
        // give someone who expressed no preference a 1920px q65 image.
        expect(tierDown("medium")).toEqual({ kind: "compress", tier: "medium" });
    });

    it("an already-lean input gets the gentlest preset, not another compression", () => {
        // Web-optimised already. Re-compressing trades visible quality for
        // almost no bytes; the keep-threshold then discards it.
        expect(tierDown("low")).toEqual({ kind: "compress", tier: "high" });
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

        /**
         * This used to assert the opposite, and the assertion was wrong.
         *
         * A PDF's tier is read from bytes per page, which for a PDF barely
         * relates to what Ghostscript can do: a long document is thin per page
         * however heavy its images are. Measured on a 5.1 MB, 100+ page LaTeX
         * thesis, Automatic reported "already compressed" and saved nothing,
         * while /printer took it to 1.8 MB - a 65% saving withheld from exactly
         * the users who expressed no preference, since Automatic is the default.
         *
         * Trying is free: KEEP_THRESHOLD discards any result gaining under 2%,
         * so a genuinely minimal PDF still comes back untouched - it just gets
         * there by measuring the output rather than predicting it.
         */
        it("tries a minimal-tier PDF anyway, because bytes-per-page cannot tell", () => {
            expect(tierDown("minimal", PDF)).toEqual({ kind: "compress", tier: "high" });
        });

        it("still skips a genuinely minimal file of any other type", () => {
            expect(tierDown("minimal", "image/jpeg")).toEqual({ kind: "skip", reason: "already-minimal" });
        });

        it("leaves every other mime on the normal ladder", () => {
            expect(tierDown("medium", "image/jpeg")).toEqual({ kind: "compress", tier: "medium" });
            expect(tierDown("hq", "video/mp4")).toEqual({ kind: "compress", tier: "medium" });
        });
    });
});
