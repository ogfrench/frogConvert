import { describe, it, expect } from "vitest";
import { detectPostScriptFlavour, wantsEpsCrop, AI_FLATTENING_NOTICE } from "./postscriptInput.ts";

const bytes = (s: string) => Uint8Array.from(s, c => c.charCodeAt(0));

describe("detectPostScriptFlavour", () => {
    it("recognises a PDF", () => {
        expect(detectPostScriptFlavour(bytes("%PDF-1.7\n..."))).toBe("pdf");
    });

    it("recognises plain PostScript and EPS", () => {
        expect(detectPostScriptFlavour(bytes("%!PS-Adobe-3.0\n"))).toBe("postscript");
        expect(detectPostScriptFlavour(bytes("%!PS-Adobe-3.0 EPSF-3.0\n"))).toBe("postscript");
    });

    it("recognises the DOS binary EPS header", () => {
        // These do not start with `%!` at all - the PostScript sits inside a
        // container alongside an optional preview image. Miss this and a
        // perfectly good EPS reads as an unknown binary.
        const binary = Uint8Array.from([0xc5, 0xd0, 0xd3, 0xc6, 0x20, 0x00, 0x00, 0x00]);
        expect(detectPostScriptFlavour(binary)).toBe("postscript");
    });

    it("says unknown rather than guessing", () => {
        expect(detectPostScriptFlavour(bytes("PK"))).toBe("unknown");
        expect(detectPostScriptFlavour(new Uint8Array(0))).toBe("unknown");
        expect(detectPostScriptFlavour(Uint8Array.from([0x25]))).toBe("unknown");
    });
});

describe("wantsEpsCrop", () => {
    it("crops .eps to its bounding box", () => {
        expect(wantsEpsCrop("eps", "postscript")).toBe(true);
    });

    it("crops an old EPS-based .ai too", () => {
        // Illustrator wrote EPS before version 9. Same bytes, different suffix.
        expect(wantsEpsCrop("ai", "postscript")).toBe(true);
    });

    it("leaves a modern PDF-based .ai on its page size", () => {
        // -dEPSCrop against a PDF is meaningless; the page box is authoritative.
        expect(wantsEpsCrop("ai", "pdf")).toBe(false);
    });

    it("never crops a plain PDF or PS", () => {
        expect(wantsEpsCrop("pdf", "pdf")).toBe(false);
        expect(wantsEpsCrop("ps", "postscript")).toBe(false);
    });
});

describe("AI_FLATTENING_NOTICE", () => {
    it("names what is actually lost instead of saying 'may be lossy'", () => {
        // #19 asks for AI's lossiness to be "stated honestly wherever it is
        // offered". Vague hedging would satisfy the letter and not the point.
        expect(AI_FLATTENING_NOTICE).toMatch(/layers/i);
        expect(AI_FLATTENING_NOTICE).toMatch(/flattened/i);
    });
});
