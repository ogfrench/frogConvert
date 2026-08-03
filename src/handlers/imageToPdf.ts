// file: imageToPdf.ts

import type { FileData, FileFormat, FormatHandler, ProgressEvent } from "../core/FormatHandler/FormatHandler.ts";
import CommonFormats from "../core/CommonFormats/CommonFormats.ts";
import { PDFDocument } from "pdf-lib";

/**
 * Images to PDF, one page per image.
 *
 * There was no route for this at all. ImageMagick is the obvious candidate and
 * cannot do it here: its WASM build ships no `pdf` coder - the live format list
 * offers `epdf` and `pocketmod` and nothing else in that family - because
 * ImageMagick services PDF by shelling out to a `gs` binary that a browser does
 * not have. Meanwhile Ghostscript declares PDF as a writable target, so the
 * picker offered "PDF" from any source and the route search then found nothing,
 * ending on "Conversion not available yet" for a conversion people plainly want.
 *
 * pdf-lib needs no engine, is already a dependency (the PDF editor merges with
 * it), and embedding a JPEG or PNG into a page is exactly what it is for.
 *
 * ## Page size
 *
 * A PDF page is measured in points. The obvious mapping - one pixel to one
 * point, 72 DPI - is what this does, so a 1080x2400 phone screenshot becomes a
 * 1080x2400pt page and nothing is resampled.
 *
 * The clamp matters. A PDF page may not exceed **14400 units (200 inches)** per
 * side, and real sources do exceed that: a 20000px-tall stitched screenshot at
 * 1pt per pixel would be a 277-inch page, which conforming readers may refuse.
 * Anything past the limit is scaled down to fit rather than written out illegal.
 * (For contrast, the bug that prompted this handler went the other way, writing
 * pages of 77760x172800pt - 1080 by 2400 *inches* - because the image carried no
 * density and 1 DPI was assumed.)
 */

/** The largest a PDF page may be, per side, in points. */
export const PDF_MAX_PAGE_POINTS = 14400;

/**
 * Page size in points for an image of the given pixel dimensions.
 *
 * One point per pixel, scaled down uniformly if that would exceed the limit -
 * uniformly so the image is never distorted, only made smaller.
 */
export function pdfPageSizeFor(widthPx: number, heightPx: number): { width: number; height: number } {
    const longest = Math.max(widthPx, heightPx);
    const scale = longest > PDF_MAX_PAGE_POINTS ? PDF_MAX_PAGE_POINTS / longest : 1;
    return { width: widthPx * scale, height: heightPx * scale };
}

/** JPEG and PNG are what pdf-lib can embed directly, without re-encoding. */
const EMBEDDABLE = new Set(["jpeg", "jpg", "png"]);

class ImageToPdfHandler implements FormatHandler {
    public name = "imageToPdf";
    public supportedFormats?: FileFormat[];
    public ready = false;
    /**
     * No re-encoding happens here - the image bytes are embedded as they
     * arrive - so the quality preset has nothing to act on. Declaring
     * otherwise would have the Converter claim a compression that never ran.
     */
    public usesQuality = false;

    async init() {
        this.supportedFormats = [
            CommonFormats.JPEG.supported("jpeg", true, false),
            CommonFormats.PNG.supported("png", true, false),
            CommonFormats.PDF.supported("pdf", false, true),
        ];
        this.ready = true;
    }

    async doConvert(
        inputFiles: FileData[],
        inputFormat: FileFormat,
        outputFormat: FileFormat,
        _args?: string[],
        onProgress?: (p: ProgressEvent) => void,
    ): Promise<FileData[]> {
        if (outputFormat.format !== "pdf") {
            throw new Error(`imageToPdf only writes PDF, not ${outputFormat.format}.`);
        }
        const kind = inputFormat.format.toLowerCase();
        if (!EMBEDDABLE.has(kind)) {
            throw new Error(`imageToPdf takes JPEG or PNG, not ${inputFormat.format}.`);
        }

        const doc = await PDFDocument.create();
        // Every input becomes a page, in order, so a batch drop yields one
        // document rather than a pile of one-page PDFs to merge afterwards.
        for (let i = 0; i < inputFiles.length; i++) {
            const file = inputFiles[i];
            onProgress?.({
                ratio: inputFiles.length > 1 ? i / inputFiles.length : undefined,
                detail: inputFiles.length > 1
                    ? `Adding image ${i + 1} of ${inputFiles.length}`
                    : undefined,
            });
            const image = kind === "png"
                ? await doc.embedPng(file.bytes)
                : await doc.embedJpg(file.bytes);
            const { width, height } = pdfPageSizeFor(image.width, image.height);
            const page = doc.addPage([width, height]);
            page.drawImage(image, { x: 0, y: 0, width, height });
        }

        const bytes = new Uint8Array(await doc.save());
        const base = inputFiles[0].name.split(".").slice(0, -1).join(".") || "images";
        // A batch collapses into one document, so the first file's name would
        // undersell it; say what it actually is.
        const name = inputFiles.length > 1 ? `${base}_and_${inputFiles.length - 1}_more.pdf` : `${base}.pdf`;
        return [{ bytes, name }];
    }
}

export default ImageToPdfHandler;
