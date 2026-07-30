import CommonFormats from "../core/CommonFormats/CommonFormats.ts";
import type { FileData, FileFormat, FormatHandler, ProgressEvent } from "../core/FormatHandler/FormatHandler.ts";
import { extractQualityPreset } from "../core/FormatHandler/FormatHandler.ts";
import { ghostscriptArgs } from "../core/compression/pdfSettings.ts";
import { GS_BASE } from "../core/compression/ghostscriptAssets.ts";

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
 *     404s on any route.
 * So: fetch the bytes here to own the progress reporting, compile them once,
 * and hand Emscripten a ready-made instance through `instantiateWasm`. That
 * sidesteps its own resolution entirely and means the 16 MB is downloaded once
 * *and compiled once*, however many PDFs the batch holds.
 *
 * Licensing: Ghostscript is AGPL-3.0. frogConvert is GPL-3.0-or-later, and
 * GPLv3 §13 explicitly permits linking with AGPLv3 code — the combined work is
 * conveyed under the GPL while this component keeps its own §13 obligation.
 * The upstream LICENSE is shipped alongside the binary.
 */

/** Emscripten module surface we actually use. */
type GsModule = {
    FS: {
        writeFile: (path: string, data: Uint8Array) => void;
        readFile: (path: string) => Uint8Array;
    };
    callMain: (args: string[]) => number;
};

type GsFactory = (opts: Record<string, unknown>) => Promise<GsModule>;

let factory: GsFactory | null = null;
/**
 * The compiled module, kept for the page's lifetime. Compiling 16 MB of wasm
 * costs far more than instantiating it, and a fresh Emscripten instance is
 * needed per file (callMain is not reliably re-entrant). Caching the
 * *compilation* and paying only for instantiation is what keeps a batch of
 * PDFs from re-doing the expensive half every time.
 */
let compiled: WebAssembly.Module | null = null;
/**
 * The in-flight load. Without it, two overlapping first calls each fetch and
 * compile their own 16 MB — the exact cost this module exists to avoid. Cleared
 * on failure so a load that failed offline can be retried once back online.
 */
let loading: Promise<GsFactory> | null = null;

/** ~16 MB, so it is fetched once and only when a PDF is actually compressed. */
function loadOnce(onProgress?: (p: ProgressEvent) => void): Promise<GsFactory> {
    if (factory && compiled) return Promise.resolve(factory);
    loading ??= fetchAndCompile(onProgress).catch((e) => { loading = null; throw e; });
    return loading;
}

async function fetchAndCompile(onProgress?: (p: ProgressEvent) => void): Promise<GsFactory> {
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
    // Explicitly ArrayBuffer-backed, not ArrayBufferLike: BlobPart rejects a
    // view that could be backed by a SharedArrayBuffer.
    let bytes: Uint8Array<ArrayBuffer>;
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
        bytes = new Uint8Array(new ArrayBuffer(got));
        let at = 0;
        for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
    } else {
        bytes = new Uint8Array(await resp.arrayBuffer());
    }

    onProgress?.({ ratio: 0.5, detail: "Starting the PDF compressor" });
    compiled = await WebAssembly.compile(bytes);
    factory = mod.default as GsFactory;
    return factory;
}

/**
 * Hands Emscripten an instance of the already-compiled module instead of
 * letting it locate and compile the binary itself. This is also the only way
 * the loader works at all outside a browser page: left to itself it resolves
 * gs.wasm against `document.currentScript`, which does not exist for an ESM
 * import or in Node.
 *
 * The hook has no error channel — Emscripten only offers `success`. If
 * instantiation rejects (out of memory on a small device is the realistic
 * case) and nobody is listening, the factory promise never settles and the
 * batch hangs on "Squishing…" forever. So the failure is routed back out to
 * the caller's reject.
 */
function instantiateWith(onError: (e: unknown) => void) {
    return (
        imports: WebAssembly.Imports,
        success: (inst: WebAssembly.Instance, mod: WebAssembly.Module) => void,
    ): Record<string, never> => {
        WebAssembly.instantiate(compiled!, imports).then(inst => success(inst, compiled!), onError);
        // Emscripten accepts an empty exports object and waits for `success`.
        return {};
    };
}

/** A fresh Emscripten instance, or a rejection — never a promise that hangs. */
function createModule(create: GsFactory): Promise<GsModule> {
    return new Promise<GsModule>((resolve, reject) => {
        create({
            noInitialRun: true,
            instantiateWasm: instantiateWith(reject),
            print: () => { /* -dQUIET still emits the odd line */ },
            printErr: () => { /* surfaced via the non-zero return code */ },
        }).then(resolve, reject);
    });
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
            const Module = await createModule(create);

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
