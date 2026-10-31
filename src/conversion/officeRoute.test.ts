import { describe, expect, it } from "vitest";
import CommonFormats from "../core/CommonFormats/CommonFormats.ts";
import type { ConvertPathNode, FormatHandler } from "../core/FormatHandler/FormatHandler.ts";
import { directOfficePath } from "./officeRoute.ts";

const handler = (name: string) => ({ name } as FormatHandler);
const node = (name: string, format: unknown) =>
    ({ handler: handler(name), format }) as ConvertPathNode;

const envelopeDocx = node("envelope", CommonFormats.DOCX.builder("docx").allowFrom());
const officeDocx = node("libreoffice", CommonFormats.DOCX.builder("docx").allowFrom());
const officePdf = node("libreoffice", CommonFormats.PDF.builder("pdf").allowTo());
const otherPdf = node("svgForeignObject", CommonFormats.PDF.builder("pdf").allowTo());
const officeXlsx = node("libreoffice", CommonFormats.XLSX.builder("xlsx").allowFrom());

describe("directOfficePath", () => {
    it("goes from the picked input straight to the engine's PDF, whichever handler owns the picked input", () => {
        // Word was picked as Envelope's DOCX; the engine's own DOCX entry is not the one chosen.
        const path = directOfficePath(envelopeDocx, [envelopeDocx, otherPdf, officeDocx, officePdf]);
        expect(path).toEqual([envelopeDocx, officePdf]);
        expect(path![1].handler.name).toBe("libreoffice");
    });

    it("returns null when the engine does not read the input", () => {
        expect(directOfficePath(envelopeDocx, [envelopeDocx, otherPdf, officeXlsx, officePdf])).toBeNull();
    });

    it("returns null when the engine is not loaded", () => {
        expect(directOfficePath(envelopeDocx, [envelopeDocx, otherPdf])).toBeNull();
    });
});
