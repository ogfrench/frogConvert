import CommonFormats from "../core/CommonFormats/CommonFormats.ts";
import { KEEP_THRESHOLD } from "../core/compression/compressBatch.ts";
import { runInWorker } from "./workerClient.ts";
import type { PdfQuality } from "../components/store/store.ts";

/**
 * Run a finished PDF through Ghostscript on its way out.
 *
 * The PDF editor's jobs — merge, organize, watermark, extract — are edits, not
 * exports, so by default they hand back exactly the document they built. When
 * the user sets the Compression control to anything but Original quality, the
 * result goes through the same engine and the same rules the Compress surface
 * uses, rather than a second, subtly different implementation.
 *
 * Two deliberate properties:
 *
 *  - **It never throws.** This step is a bonus on top of work the user already
 *    asked for and already succeeded at. Losing a completed merge because the
 *    optional squeeze failed would be a far worse outcome than a larger file,
 *    so every failure returns the original bytes.
 *  - **It honours the 98% keep-threshold**, the same one `compressBatch` uses.
 *    A "compressed" PDF that came back the same size has traded image quality
 *    for nothing, so the original wins.
 */

const PDF_FORMAT = CommonFormats.PDF.supported("pdf", true, true);

export async function compressPdfOutput(
    bytes: Uint8Array,
    level: PdfQuality,
    name = "document.pdf",
): Promise<Uint8Array> {
    if (level === "lossless") return bytes;

    try {
        const out = await runInWorker(
            "Ghostscript",
            [{ name, bytes }],
            PDF_FORMAT,
            PDF_FORMAT,
            ["--quality", level],
        );
        const produced = out?.[0]?.bytes;
        if (!produced?.byteLength) return bytes;
        return produced.byteLength < bytes.byteLength * KEEP_THRESHOLD ? produced : bytes;
    } catch (e) {
        console.warn("[pdf] optional output compression failed, keeping the original", e);
        return bytes;
    }
}

/** Apply {@link compressPdfOutput} across a batch, in order. */
export async function compressPdfOutputs(
    results: readonly { bytes: Uint8Array; name: string }[],
    level: PdfQuality,
): Promise<{ bytes: Uint8Array; name: string }[]> {
    if (level === "lossless") return results.map(r => ({ ...r }));
    const out: { bytes: Uint8Array; name: string }[] = [];
    for (const r of results) {
        out.push({ name: r.name, bytes: await compressPdfOutput(r.bytes, level, r.name) });
    }
    return out;
}
