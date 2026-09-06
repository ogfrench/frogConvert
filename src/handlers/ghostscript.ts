import CommonFormats from "../core/CommonFormats/CommonFormats.ts";
import type { FileData, FileFormat, FormatHandler, ProgressEvent } from "../core/FormatHandler/FormatHandler.ts";
import { extractQualityPreset } from "../core/FormatHandler/FormatHandler.ts";
import { ghostscriptArgs } from "../core/compression/pdfSettings.ts";
import { assertPdfPagesPreserved } from "../core/compression/pdfIntegrity.ts";
import { GS_BASE } from "../core/compression/ghostscriptAssets.ts";
import {
    GS_INPUT_FORMATS,
    GS_OUTPUT_ROUTES,
    runGhostscriptConversion,
} from "../core/ghostscript/convert.ts";

/**
 * Ghostscript-WASM - PDF→PDF recompression, plus the PostScript family,
 * PDF/A and multi-page TIFF.
 *
 * The compression pass came first and is still the common case; the conversion
 * routes ride along on the same 16 MB binary rather than adding a second engine
 * for formats it already speaks natively. Their argv and output handling live
 * in core/ghostscript/ so the Node sibling shares them verbatim.
 *
 * Why this exists rather than reusing the canvas + pdf-lib route: that route
 * rasterises pages, so it can only shrink a PDF by throwing away the very thing
 * that makes a PDF a PDF. On a vector/text document it saves nothing (measured:
 * 0%), and on a scan it wins only by making the text fuzzy. Ghostscript's
 * pdfwrite device resamples embedded images and rebuilds the object streams
 * while leaving text and vectors as text and vectors.
 *
 * Loading is deliberately awkward - see scripts/ghostscript-smoke.mjs:
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
 * GPLv3 §13 explicitly permits linking with AGPLv3 code - the combined work is
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
 * compile their own 16 MB - the exact cost this module exists to avoid. Cleared
 * on failure so a load that failed offline can be retried once back online.
 */
let loading: Promise<GsFactory> | null = null;

/**
 * What to call the 16 MB download while it is happening. The same binary backs
 * Compress and the PostScript conversions, and "Fetching the PDF compressor"
 * makes no sense to someone who just dropped an EPS on the Converter.
 */
type EngineLabel = "compressor" | "converter";
const ENGINE_NAME: Record<EngineLabel, string> = {
    compressor: "PDF compressor",
    converter: "PostScript engine",
};

/** ~16 MB, so it is fetched once and only when the engine is actually used. */
function loadOnce(onProgress?: (p: ProgressEvent) => void, label: EngineLabel = "compressor"): Promise<GsFactory> {
    if (factory && compiled) return Promise.resolve(factory);
    loading ??= fetchAndCompile(onProgress, label).catch((e) => { loading = null; throw e; });
    return loading;
}

async function fetchAndCompile(onProgress?: (p: ProgressEvent) => void, label: EngineLabel = "compressor"): Promise<GsFactory> {
    const engine = ENGINE_NAME[label];
    onProgress?.({ ratio: 0, detail: `Fetching the ${engine} (one-time, ~16 MB)` });

    // @vite-ignore: this must stay a runtime URL import of the copied asset.
    // Letting Vite resolve it pulls gs.js through the bundler, which breaks the
    // globalThis.exports handshake gs.mjs depends on.
    const mod = await import(/* @vite-ignore */ `${GS_BASE}/gs.mjs`);
    const resp = await fetch(`${GS_BASE}/gs.wasm`);
    if (!resp.ok) throw new Error(`Couldn't fetch the ${engine} (${resp.status})`);

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
                detail: `Fetching the ${engine} (${Math.round((got / total) * 100)}%)`,
            });
        }
        bytes = new Uint8Array(new ArrayBuffer(got));
        let at = 0;
        for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
    } else {
        bytes = new Uint8Array(await resp.arrayBuffer());
    }

    onProgress?.({ ratio: 0.5, detail: `Starting the ${engine}` });
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
 * The hook has no error channel - Emscripten only offers `success`. If
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

/**
 * Where a running pass's stdout goes, or null when nothing is listening.
 *
 * Module-level rather than per-instance because the tap below has to be
 * installed *before* the Emscripten factory runs and stays bound for the life
 * of that instance. Safe as a single slot: `workerClient` serialises every job
 * onto one worker, and `callMain` is synchronous, so two passes can never be
 * mid-flight at once.
 */
let gsStdout: ((line: string) => void) | null = null;

/**
 * Emscripten's `out` is `console.log.bind(console)`, captured when the factory
 * runs. This build drops the `print`/`printErr` module options entirely - they
 * are marked unsupported in the minified loader - so the only way to read what
 * Ghostscript prints is to own `console.log` across the factory call and let it
 * bind to a tap instead.
 *
 * Narrow on purpose: `console.log` is restored the moment the factory
 * resolves, and the tap it left behind forwards to the real one whenever no
 * pass is listening.
 */
function createModule(create: GsFactory): Promise<GsModule> {
    return new Promise<GsModule>((resolve, reject) => {
        const realLog = console.log;
        const tap = (...args: unknown[]) => {
            const sink = gsStdout;
            if (!sink) { realLog(...args); return; }
            sink(args.join(" "));
        };
        console.log = tap as typeof console.log;
        const restore = () => { console.log = realLog; };
        create({
            noInitialRun: true,
            instantiateWasm: instantiateWith(reject),
        }).then(
            (mod) => { restore(); resolve(mod); },
            (err) => { restore(); reject(err); },
        );
    });
}

/**
 * Read a pdfwrite pass as it happens.
 *
 * With `-dQUIET` off, Ghostscript prints "Processing pages 1 through 40."
 * and then a bare "Page n" as each one is written. That is the only progress
 * the engine offers, and without it the compression pass was the longest
 * unnarrated wait in the app: a phone grinding through a scanned document
 * showed one unchanging line for minutes, which reads as a hang rather than
 * as work. The lines arrive synchronously from inside `callMain`, and this
 * runs in a Worker, so each `postMessage` the progress callback makes reaches
 * the main thread while the pass is still running.
 *
 * Anything that is not a page line (the AGPL banner, warnings about the input)
 * is dropped rather than forwarded to the console: it is a fixed four-line
 * preamble per file and says nothing a user or a log needs.
 */
export function readPageLine(line: string, state: { total: number }): { n: number; total: number } | null {
    const start = /^Processing pages (\d+) through (\d+)\.?$/.exec(line);
    if (start) {
        state.total = Number(start[2]) - Number(start[1]) + 1;
        return null;
    }
    const page = /^Page (\d+)$/.exec(line);
    if (!page || state.total <= 0) return null;
    return { n: Number(page[1]), total: state.total };
}

class GhostscriptHandler implements FormatHandler {
    public name = "Ghostscript";

    // Declared statically so every format is selectable before the WASM has
    // ever been fetched - nobody should pay 16 MB to find out what is on offer.
    public supportedFormats: FileFormat[] = [
        CommonFormats.PDF.supported("pdf", true, true),
        // The PostScript family. Ghostscript reads all three natively - this is
        // the interpreter those formats are defined by - and writes PS and EPS
        // back out through ps2write/eps2write.
        CommonFormats.PS.supported("ps", true, true),
        CommonFormats.EPS.supported("eps", true, true),
        // Read-only: .ai is a container we can open honestly but should never
        // claim to author. See AI_FLATTENING_NOTICE.
        CommonFormats.AI.supported("ai", true, false),
        // Output-only by design; see the CommonFormats entry.
        CommonFormats.PDFA.supported("pdfa", false, true),
        // Multi-page TIFF, which nothing else in the app produces.
        CommonFormats.TIFF.supported("tiff", false, true),
    ];

    public ready = false;
    // Emscripten + fetch only; no DOM. Running off the main thread keeps a
    // multi-second pass on a large PDF from freezing the page.
    public requiresMainThread = false;
    /** Reads `--quality`: this engine is one of the few that actually does. */
    public usesQuality = true;

    async init() {
        // Deliberately does not download here. init() is called before a batch
        // starts, and paying 16 MB to discover a file is 40 kB of text would be
        // a poor trade. doConvert fetches on first real use.
        this.ready = true;
    }

    async doConvert(
        inputFiles: FileData[],
        inputFormat: FileFormat,
        outputFormat: FileFormat,
        args?: string[],
        onProgress?: (p: ProgressEvent) => void,
    ): Promise<FileData[]> {
        const route = GS_OUTPUT_ROUTES[outputFormat.format];
        if (!route) {
            throw new Error(`Ghostscript can't write ${outputFormat.format.toUpperCase()}.`);
        }
        if (!GS_INPUT_FORMATS.has(inputFormat.format)) {
            throw new Error(`Ghostscript can't read ${inputFormat.format.toUpperCase()}.`);
        }

        // PDF in and PDF out is the compression pass, not a conversion: it keeps
        // the distiller presets and the original filename. Everything else is a
        // format change and goes through the shared conversion path.
        const isCompression = inputFormat.format === "pdf" && outputFormat.format === "pdf";
        const quality = extractQualityPreset(args) ?? "medium";
        const create = await loadOnce(onProgress, isCompression ? "compressor" : "converter");

        const outputs: FileData[] = [];
        for (let i = 0; i < inputFiles.length; i++) {
            const file = inputFiles[i];
            onProgress?.({
                // Position in the batch, not progress through this file - so it
                // is only worth reporting when there is a batch. With a single
                // file this evaluated to exactly 0.5 and stayed there for the
                // whole pass, painting a frozen "50%" on screen. A number that
                // never moves reads as a stall, which is the failure the live
                // line exists to prevent; the page count below and the elapsed
                // clock carry this case honestly instead.
                ratio: inputFiles.length > 1
                    ? 0.5 + (i / inputFiles.length) * 0.5
                    : undefined,
                // The compression pass says nothing here on purpose. Every
                // surface that runs it already shows the file name of its own
                // accord - Compress puts it under the heading, the PDF editor
                // has only ever one document - so "Compressing report.pdf"
                // under a subtitle reading "report.pdf" spent the one live row
                // saying the same thing twice. The per-page lines below take
                // this row instead, and they say something new.
                detail: isCompression ? undefined : `Converting ${file.name}`,
            });

            if (!isCompression) {
                outputs.push(...await runGhostscriptConversion({
                    // A fresh module per file: callMain() is not reliably
                    // re-entrant and Ghostscript keeps global state across a run.
                    createInstance: () => createModule(create),
                    file,
                    inputExtension: inputFormat.extension.toLowerCase(),
                    route,
                    outputExtension: outputFormat.extension.toLowerCase(),
                    quality,
                }));
                continue;
            }

            const Module = await createModule(create);

            const inPath = "/in.pdf";
            const outPath = "/out.pdf";
            Module.FS.writeFile(inPath, file.bytes);

            // Batch position on the front, when there is a batch. A page count
            // with nothing to anchor it says "Page 3 of 40" twice in a row for
            // two different documents.
            const prefix = inputFiles.length > 1 ? `File ${i + 1} of ${inputFiles.length} · ` : "";
            const pageState = { total: 0 };
            gsStdout = (line) => {
                const at = readPageLine(line, pageState);
                if (!at) return;
                onProgress?.({ ratio: at.n / at.total, detail: `${prefix}Page ${at.n} of ${at.total}` });
            };
            let rc: number;
            try {
                rc = Module.callMain(ghostscriptArgs({
                    quality, inputPath: inPath, outputPath: outPath, verbose: true,
                }));
            } finally {
                gsStdout = null;
            }
            if (rc !== 0) throw new Error(`Couldn't compress ${file.name}. The PDF may be corrupt or password-protected.`);

            const bytes = Module.FS.readFile(outPath);
            // Ghostscript can exit 0 having written something that is not a PDF
            // (e.g. an empty file for an unreadable input); refuse to hand that back.
            if (bytes.byteLength < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") {
                throw new Error(`Couldn't compress ${file.name}. The result wasn't a readable PDF.`);
            }
            // ...and a *readable* PDF can still be the wrong document: a damaged
            // input comes back as one blank page, which every check above passes.
            //
            // Announced, because it is not instant: the guard parses both
            // documents with pdf-lib, which on a long scan is seconds of its
            // own - and until it says so the page count sits frozen on its
            // last page, which is the shape of a stall.
            onProgress?.({ ratio: 1, detail: `${prefix}Checking the result` });
            await assertPdfPagesPreserved(file.bytes, bytes, file.name);

            outputs.push({ ...file, name: file.name, bytes });
        }

        return outputs;
    }
}

export default GhostscriptHandler;
