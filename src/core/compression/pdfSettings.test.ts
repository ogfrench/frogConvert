import { describe, it, expect } from "vitest";
import { pdfSettingsFor, ghostscriptArgs, expectedSavingsNote } from "./pdfSettings.ts";

describe("pdfSettingsFor", () => {
    it("maps the quality target onto Ghostscript's distiller presets", () => {
        // The inversion trap again: `low` is the lowest quality *target*, so it
        // must land on /screen (72 dpi), the most aggressive preset. Swapping
        // these two would silently turn "Smallest file" into "barely touched".
        expect(pdfSettingsFor("low")).toBe("/screen");
        expect(pdfSettingsFor("medium")).toBe("/ebook");
        expect(pdfSettingsFor("high")).toBe("/printer");
        expect(pdfSettingsFor("lossless")).toBe("/prepress");
    });

    it("orders the presets from most to least aggressive", () => {
        // Encodes the intended ordering so a future edit cannot make a
        // higher-quality level compress harder than a lower-quality one.
        const dpi = { "/screen": 72, "/ebook": 150, "/printer": 300, "/prepress": 300 } as const;
        const order = (["low", "medium", "high", "lossless"] as const).map(q => dpi[pdfSettingsFor(q)]);
        for (let i = 1; i < order.length; i++) {
            expect(order[i]).toBeGreaterThanOrEqual(order[i - 1]);
        }
    });
});

describe("ghostscriptArgs", () => {
    it("builds a non-interactive pdfwrite invocation", () => {
        const args = ghostscriptArgs({ quality: "medium", inputPath: "/in.pdf", outputPath: "/out.pdf" });
        expect(args).toContain("-sDEVICE=pdfwrite");
        expect(args).toContain("-dPDFSETTINGS=/ebook");
        // Without these it waits for input and never returns in WASM.
        expect(args).toContain("-dNOPAUSE");
        expect(args).toContain("-dBATCH");
        expect(args).toContain("-sOutputFile=/out.pdf");
        // Input must come last; Ghostscript treats trailing operands as files.
        expect(args[args.length - 1]).toBe("/in.pdf");
    });

    it("threads the chosen level through to the preset flag", () => {
        const of = (q: "low" | "high") =>
            ghostscriptArgs({ quality: q, inputPath: "/i", outputPath: "/o" })
                .find(a => a.startsWith("-dPDFSETTINGS="));
        expect(of("low")).toBe("-dPDFSETTINGS=/screen");
        expect(of("high")).toBe("-dPDFSETTINGS=/printer");
    });
});

describe("expectedSavingsNote", () => {
    it("promises less when the document is mostly text", () => {
        // Ghostscript's presets only resample images, so a text PDF genuinely
        // cannot shrink much. Saying so keeps a correct result from reading as
        // a broken one.
        expect(expectedSavingsNote(20_000)).toMatch(/text-heavy|small/i);
        expect(expectedSavingsNote(2_000_000)).toMatch(/image-heavy|big/i);
        expect(expectedSavingsNote(500_000)).toMatch(/mixed|moderate/i);
    });
});
