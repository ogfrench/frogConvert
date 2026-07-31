import { describe, it, expect } from "vitest";
import { gsConvertArgs, needsPerPageOutput, GS_BASE_FLAGS } from "./args.ts";

/**
 * These assert the flags that were *measured* to matter, not the whole argv.
 * Every value here has a number behind it in scripts/gs-postscript-probe.mjs;
 * getting one wrong produces a file that opens and is quietly wrong, which is
 * the failure mode worth a test.
 */
describe("gsConvertArgs", () => {
    const base = { inputPath: "/in.pdf", outputPath: "/out.x" } as const;

    it("always carries the flags that stop Ghostscript waiting for input", () => {
        for (const route of ["pdf", "pdfa", "ps", "eps", "tiff"] as const) {
            const args = gsConvertArgs({ ...base, route });
            for (const flag of GS_BASE_FLAGS) expect(args).toContain(flag);
            expect(args[args.length - 1]).toBe("/in.pdf");
        }
    });

    it("picks the device each route needs", () => {
        const device = (route: Parameters<typeof gsConvertArgs>[0]["route"]) =>
            gsConvertArgs({ ...base, route }).find(a => a.startsWith("-sDEVICE="));
        expect(device("pdf")).toBe("-sDEVICE=pdfwrite");
        expect(device("pdfa")).toBe("-sDEVICE=pdfwrite");
        expect(device("ps")).toBe("-sDEVICE=ps2write");
        expect(device("eps")).toBe("-sDEVICE=eps2write");
        expect(device("tiff")).toBe("-sDEVICE=tiff24nc");
    });

    it("compresses TIFF, because the device default is raw", () => {
        // tiff24nc's default is uncompressed: a 3-page vector PDF at 150 dpi
        // measured 19,583,480 B raw against 54,929 B with LZW.
        expect(gsConvertArgs({ ...base, route: "tiff" })).toContain("-sCompression=lzw");
    });

    it("scales TIFF resolution with the quality preset", () => {
        const dpi = (quality: "low" | "medium" | "high") =>
            gsConvertArgs({ ...base, route: "tiff", quality }).find(a => a.startsWith("-r"));
        expect(dpi("low")).toBe("-r96");
        expect(dpi("medium")).toBe("-r150");
        expect(dpi("high")).toBe("-r300");
    });

    it("asks for a real PDF/A, not just a pdfwrite pass", () => {
        const args = gsConvertArgs({ ...base, route: "pdfa" });
        expect(args).toContain("-dPDFA=2");
        // Without a compatibility policy Ghostscript abandons the conversion on
        // anything it can't represent; 1 tells it to drop and carry on.
        expect(args).toContain("-dPDFACompatibilityPolicy=1");
        // Device-independent colour is required by the standard itself.
        expect(args).toContain("-sColorConversionStrategy=UseDeviceIndependentColor");
    });

    it("makes the quality level do something on every route", () => {
        // Regression guard for an inert control. The distiller preset is the
        // only lever the level has on the vector routes, and without it a
        // PS -> PDF came out at the same 441,968 B whatever the user picked -
        // against a real range of 127,981 B to 1,923,019 B on the same source.
        // The video levels shipped with exactly this defect earlier in v3.
        for (const route of ["pdf", "pdfa", "ps", "eps"] as const) {
            const at = (quality: "low" | "medium" | "high") =>
                gsConvertArgs({ ...base, route, quality }).find(a => a.startsWith("-dPDFSETTINGS="));
            expect(at("low")).toBe("-dPDFSETTINGS=/screen");
            expect(at("medium")).toBe("-dPDFSETTINGS=/ebook");
            expect(at("high")).toBe("-dPDFSETTINGS=/printer");
        }
        // TIFF has no distiller; its lever is resolution, covered above.
        expect(gsConvertArgs({ ...base, route: "tiff" }).some(a => a.startsWith("-dPDFSETTINGS=")))
            .toBe(false);
    });

    it("keeps PDF/A's compliance flags alongside the distiller preset", () => {
        // Downsampling does not cost compliance - verified against the engine,
        // the output still carries its pdfaid marker at every preset - but
        // dropping a required flag while adding one would.
        const args = gsConvertArgs({ ...base, route: "pdfa", quality: "low" });
        expect(args).toContain("-dPDFA=2");
        expect(args).toContain("-sColorConversionStrategy=UseDeviceIndependentColor");
        expect(args).toContain("-dPDFSETTINGS=/screen");
    });

    it("adds -dEPSCrop only when asked", () => {
        expect(gsConvertArgs({ ...base, route: "pdf" })).not.toContain("-dEPSCrop");
        expect(gsConvertArgs({ ...base, route: "pdf", epsCrop: true })).toContain("-dEPSCrop");
    });

    it("puts the output path in the argv verbatim", () => {
        expect(gsConvertArgs({ ...base, route: "eps", outputPath: "/out-%d.eps" }))
            .toContain("-sOutputFile=/out-%d.eps");
    });
});

describe("needsPerPageOutput", () => {
    it("is true only for EPS, which cannot hold more than one page", () => {
        // Measured: pointing eps2write at a 3-page PDF with a single output name
        // exits 0 and writes a file that round-trips back to *one* page. The
        // other two are gone with no error anywhere the user can see.
        expect(needsPerPageOutput("eps")).toBe(true);
        for (const route of ["pdf", "pdfa", "ps", "tiff"] as const) {
            expect(needsPerPageOutput(route)).toBe(false);
        }
    });
});
