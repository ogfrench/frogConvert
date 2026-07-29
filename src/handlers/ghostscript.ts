import CommonFormats from "../core/CommonFormats/CommonFormats.ts";
import type { FileData, FileFormat, FormatHandler, ProgressEvent } from "../core/FormatHandler/FormatHandler.ts";
import { extractQualityPreset } from "../core/FormatHandler/FormatHandler.ts";
import { ghostscriptArgs } from "../core/compression/pdfSettings.ts";

/**
 * Ghostscript-WASM — PDF→PDF recompression.
 *
 * Why this exists rather than reusing the canvas + pdf-lib route: that route
 * rasterises pages, so it can only shrink a PDF by throwing away the very thing
 * that makes a PDF a PDF. On a vector/text document it saves nothing (measured:
 * 0%), and on a scan it wins only by making the text fuzzy. Ghostscript's
 * pdfwrite device resamples embedded images and rebuilds the object streams
 * while leaving text and vectors as text and vectors.
 *
 * Loading is deliberately awkward — see scripts/ghostscript-smoke.mjs:
 *   - gs.mjs branches on `globalThis.process`; the node branch resolves the wasm
 *     through a file:// URL that fetch() rejects.
 *   - The browser branch reads `globalThis.exports.Module`, a side-channel set
 *     by browser.js at import time, so the files must load as a set. They are
 *     copied verbatim to /wasm/gs by vite-plugin-static-copy so the relative
 *     imports resolve; bundling them breaks that handshake.
 *   - This build **ignores `Module.wasmBinary`** and always locates the binary
 *     itself. Its `_scriptDir` comes from `document.currentScript`, which is
 *     null for an ESM import, so it resolves gs.wasm against the *page* URL and
 *     404s on any route. `locateFile` is the option that actually steers it.
 *     (The smoke test appeared to work via `wasmBinary` only because there the
 *     wasm happened to sit next to the loader and Emscripten fetched it itself.)
 * So: fetch the bytes here to own the progress reporting, hand them to
 * Emscripten as a blob URL through `locateFile`, and the 16 MB crosses the wire
 * exactly once.
 *
 * Licensing: Ghostscript is AGPL-3.0. frogConvert is GPL-3.0-or-later, and
 * GPLv3 §13 explicitly permits linking with AGPLv3 code — the combined work is
 * conveyed under the GPL while this component keeps its own §13 obligation.
 * The upstream LICENSE is shipped alongside the binary.
 */

const GS_BASE = "/wasm/gs";

/** Emscripten module surface we actually use. */
type GsModule = {
    FS: {
        writeFile: (path: string, data: Uint8Array) => void;
        readFile: (path: string) => Uint8Array;
        unlink: (path: string) => void;
    };
    callMain: (args: string[]) => number;
};

type GsFactory = (opts: Record<string, unknown>) => Promise<GsModule>;

let factory: GsFactory | null = null;
/** Blob URL for the fetched wasm. Held for the page's lifetime on purpose: a
 *  fresh Module is built per file and each one re-reads this URL, so revoking
 *  it after the first init would break every file after the first. */
let wasmUrl: string | null = null;

/** ~16 MB, so it is fetched once and only when a PDF is actually compressed. */
async function loadOnce(onProgress?: (p: ProgressEvent) => void): Promise<GsFactory> {
    if (factory && wasmUrl) return factory;

    onProgress?.({ ratio: 0, detail: "Fetching the PDF compressor (one-time, ~16 MB)" });

    // @vite-ignore: this must stay a runtime URL import of the copied asset.
    // Letting Vite resolve it pulls gs.js through the bundler, which breaks the
    // globalThis.exports handshake gs.mjs depends on.
    const mod = await import(/* @vite-ignore */ `${GS_BASE}/gs.mjs`);
    const resp = await fetch(`${GS_BASE}/gs.wasm`);
    if (!resp.ok) throw new Error(`Couldn't fetch the PDF compressor (${resp.status})`);

    // Streamed so the one-time download reports progress instead of looking
    // frozen. Content-Length is present for a static asset but not guaranteed,
    // so fall back to a plain read when it is missing.
    const total = Number(resp.headers.get("content-length")) || 0;
    let bytes: Uint8Array;
    if (resp.body && total > 0) {
        const reader = resp.body.getReader();
        const chunks: Uint8Array[] = [];
        let got = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            got += value.byteLength;
            onProgress?.({
                ratio: (got / total) * 0.5,
                detail: `Fetching the PDF compressor — ${Math.round((got / total) * 100)}%`,
            });
        }
        bytes = new Uint8Array(got);
        let at = 0;
        for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
    } else {
        bytes = new Uint8Array(await resp.arrayBuffer());
    }

    // The blob needs the wasm MIME type or instantiateStreaming rejects it and
    // Emscripten falls back to a slower ArrayBuffer path.
    wasmUrl = URL.createObjectURL(new Blob([bytes], { type: "application/wasm" }));
    factory = mod.default as GsFactory;
    return factory;
}

/** Steers Emscripten to the already-downloaded binary instead of guessing a URL. */
function locateFile(path: string): string {
    return path.endsWith(".wasm") && wasmUrl ? wasmUrl : `${GS_BASE}/${path}`;
}

class GhostscriptHandler implements FormatHandler {
    public name = "Ghostscript";

    public supportedFormats: FileFormat[] = [
        // PDF in, PDF out. Declared statically so the format is selectable
        // before the WASM has ever been fetched.
        CommonFormats.PDF.supported("pdf", true, true),
    ];

    public ready = false;
    // Emscripten + fetch only; no DOM. Running off the main thread keeps a
    // multi-second pass on a large PDF from freezing the page.
    public requiresMainThread = false;

    async init() {
        // Deliberately does not download here. init() is called before a batch
        // starts, and paying 16 MB to discover a file is 40 kB of text would be
        // a poor trade. doConvert fetches on first real use.
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
            throw new Error("Ghostscript only writes PDF. Use the PDF converter for other formats.");
        }

        const quality = extractQualityPreset(args) ?? "medium";
        const create = await loadOnce(onProgress);

        const outputs: FileData[] = [];
        for (let i = 0; i < inputFiles.length; i++) {
            const file = inputFiles[i];
            onProgress?.({
                ratio: 0.5 + (i / inputFiles.length) * 0.5,
                detail: `Compressing ${file.name}`,
            });

            // A fresh module per file: callMain() is not reliably re-entrant in
            // Emscripten builds, and Ghostscript keeps global state across a run.
            const Module = await create({
                noInitialRun: true,
                locateFile,
                print: () => { /* -dQUIET still emits the odd line */ },
                printErr: () => { /* surfaced via the non-zero return code */ },
            });

            const inPath = "/in.pdf";
            const outPath = "/out.pdf";
            Module.FS.writeFile(inPath, file.bytes);

            const rc = Module.callMain(ghostscriptArgs({ quality, inputPath: inPath, outputPath: outPath }));
            if (rc !== 0) throw new Error(`Couldn't compress ${file.name} — the PDF may be corrupt or password-protected.`);

            const bytes = Module.FS.readFile(outPath);
            // Ghostscript can exit 0 having written something that is not a PDF
            // (e.g. an empty file for an unreadable input); refuse to hand that back.
            if (bytes.byteLength < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") {
                throw new Error(`Couldn't compress ${file.name} — the result wasn't a readable PDF.`);
            }

            outputs.push({ ...file, name: file.name, bytes });
        }

        return outputs;
    }
}

export default GhostscriptHandler;
