import CommonFormats from "../core/CommonFormats/CommonFormats.ts";
import type { FileData, FileFormat, FormatHandler, ProgressEvent } from "../core/FormatHandler/FormatHandler.ts";
import { extractQualityPreset } from "../core/FormatHandler/FormatHandler.ts";
import { presetFor } from "../core/FormatHandler/qualityPresets.ts";
import { planImage } from "../core/compression/plan.ts";
import { isSafari } from "../tools/pdfThumbnails.ts";
import { rethrowIfPasswordProtected } from "./_pdfErrors.ts";

import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/**
 * Last-resort PDF compressor: rasterise every page and rebuild the document
 * from JPEGs.
 *
 * This is strictly worse than Ghostscript and is not a second opinion - it is
 * what you get when the 16 MB Ghostscript payload cannot be fetched at all
 * (offline, blocked, or a failed deploy). It destroys the document's structure:
 * text stops being text, so selection, search, copy/paste, accessibility and
 * any embedded links are gone, and vector art gains resampling artefacts.
 * On a vector/text PDF it usually produces a *larger* file, which the batch's
 * keep-threshold then discards - the honest outcome, since there was nothing
 * to gain.
 *
 * It earns its place only on scans and image-heavy decks, where the pages were
 * already pictures and re-encoding them at a sane DPI is a real saving.
 *
 * Runs on the main thread because it needs a 2D canvas; Ghostscript stays in
 * the worker. That split is why this is a separate handler rather than a
 * branch inside `ghostscript.ts`: `requiresMainThread` is a static property of
 * a handler, and forcing Ghostscript onto the main thread to share one class
 * would freeze the page during every normal compression.
 */

/** Matches pdftoimg: keeps a 400-page scan from exhausting canvas memory. */
const MAX_TOTAL_MEGAPIXELS = 600;

/**
 * pdf.js and pdf-lib are loaded on demand, not at module scope.
 *
 * This handler is registered in the background for every session but only ever
 * *runs* when Ghostscript could not be fetched at all - so a static import
 * would put pdf-lib (which nothing else outside the PDF editor pulls) into
 * every visitor's download to serve a path almost none of them take.
 */
type PdfLibs = {
    pdfjsLib: typeof import("pdfjs-dist");
    PDFDocument: typeof import("pdf-lib").PDFDocument;
};
let libs: Promise<PdfLibs> | null = null;

function loadPdfLibs(): Promise<PdfLibs> {
    libs ??= Promise.all([import("pdfjs-dist"), import("pdf-lib")])
        .then(([pdfjsLib, pdfLib]) => {
            pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
            return { pdfjsLib, PDFDocument: pdfLib.PDFDocument };
        })
        .catch((e) => { libs = null; throw e; });
    return libs;
}

class PdfCanvasCompressHandler implements FormatHandler {
    public name = "PdfCanvasCompress";

    public supportedFormats: FileFormat[] = [
        CommonFormats.PDF.supported("pdf", true, true),
    ];

    public ready = false;
    public requiresMainThread = true;

    async init() {
        this.ready = true;
    }

    async doConvert(
        inputFiles: FileData[],
        _inputFormat: FileFormat,
        outputFormat: FileFormat,
        args?: string[],
        onProgress?: (p: ProgressEvent) => void,
    ): Promise<FileData[]> {
        if (outputFormat.format !== "pdf") {
            throw new Error("This route only writes PDF.");
        }
        if (isSafari()) {
            throw new Error("PDF compression isn't supported on Safari. Try Chrome or Firefox.");
        }

        const quality = extractQualityPreset(args) ?? "medium";
        const preset = presetFor(quality);
        // "document-page" is the archetype pdftoimg uses for page rasterisation:
        // text-heavy output where crispness matters more than raw byte count.
        const jpegQuality = planImage({
            pixelCount: 0,
            preset: quality,
            outputLossless: false,
            archetype: "document-page",
        }).imgQuality / 100;

        const { pdfjsLib, PDFDocument } = await loadPdfLibs();

        const outputs: FileData[] = [];
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D context unavailable");

        try {
            for (const file of inputFiles) {
                const bytes = await this.rebuild(
                    { pdfjsLib, PDFDocument }, file, preset.pdfDpi, jpegQuality, canvas, ctx, onProgress);
                outputs.push({ ...file, name: file.name, bytes });
            }
        } finally {
            // A page-sized canvas holds several MB of backing store and the
            // element itself is unreachable from here on. Zeroing it releases
            // that immediately rather than at the GC's convenience.
            canvas.width = 0;
            canvas.height = 0;
        }
        return outputs;
    }

    private async rebuild(
        { pdfjsLib, PDFDocument }: PdfLibs,
        file: FileData,
        dpi: number,
        jpegQuality: number,
        canvas: HTMLCanvasElement,
        ctx: CanvasRenderingContext2D,
        onProgress?: (p: ProgressEvent) => void,
    ): Promise<Uint8Array> {
        let doc;
        try {
            doc = await pdfjsLib.getDocument({ data: file.bytes.slice() }).promise;
        } catch (e) {
            rethrowIfPasswordProtected(e, file.name);
            throw new Error(`Couldn't read ${file.name}.`);
        }

        try {
            const out = await PDFDocument.create();
            const scale = dpi / 72;

            // Budget the whole document, not each page: 400 small pages can add
            // up to more pixels than a handful of large ones.
            let budget = MAX_TOTAL_MEGAPIXELS * 1_000_000;

            for (let n = 1; n <= doc.numPages; n++) {
                const page = await doc.getPage(n);
                const base = page.getViewport({ scale: 1 });
                let viewport = page.getViewport({ scale });

                const px = viewport.width * viewport.height;
                if (px > budget) {
                    // Shrink this page to whatever budget remains rather than
                    // aborting the whole document.
                    const shrink = Math.sqrt(Math.max(budget, 1) / px);
                    viewport = page.getViewport({ scale: scale * shrink });
                }
                budget -= viewport.width * viewport.height;

                canvas.width = Math.max(1, Math.floor(viewport.width));
                canvas.height = Math.max(1, Math.floor(viewport.height));
                // Pages may be transparent; JPEG has no alpha, so paint white
                // first or the transparent areas encode as black.
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                await page.render({ canvasContext: ctx, viewport, canvas }).promise;

                const blob = await new Promise<Blob | null>(r =>
                    canvas.toBlob(r, "image/jpeg", jpegQuality));
                if (!blob) throw new Error(`Couldn't rasterise page ${n} of ${file.name}.`);

                const jpg = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
                // Keep the original page geometry in points so the rebuilt
                // document still prints at the right physical size.
                const p = out.addPage([base.width, base.height]);
                p.drawImage(jpg, { x: 0, y: 0, width: base.width, height: base.height });

                onProgress?.({ ratio: n / doc.numPages, detail: `Rasterising page ${n} of ${doc.numPages}` });
            }

            return await out.save();
        } finally {
            // pdf.js keeps the parsed document alive in its worker until told
            // otherwise; without this a multi-file batch accumulates every one.
            await doc.destroy().catch(() => { /* already torn down */ });
        }
    }
}

export default PdfCanvasCompressHandler;
