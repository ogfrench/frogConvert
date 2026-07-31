import CommonFormats from "../core/CommonFormats/CommonFormats.ts";
import type { FileData, FileFormat, FormatHandler } from "../core/FormatHandler/FormatHandler.ts";
import { extractQualityPreset } from "../core/FormatHandler/FormatHandler.ts";
import { ghostscriptArgs } from "../core/compression/pdfSettings.ts";
import {
    GS_INPUT_FORMATS,
    GS_OUTPUT_ROUTES,
    runGhostscriptConversion,
} from "../core/ghostscript/convert.ts";

/**
 * Ghostscript-WASM for Node/Bun - the MCP, REST and CLI surfaces.
 *
 * A sibling of `ghostscript.ts` rather than a branch inside it. The browser
 * build reaches the engine over HTTP (`/wasm/gs`, copied there by
 * vite-plugin-static-copy) and reports download progress; here the files are
 * simply on disk in node_modules. Merging the two would mean either shipping
 * `node:fs`/`node:module` imports into the browser bundle or hiding them behind
 * specifier tricks to fool the bundler - both worse than one small sibling that
 * shares the part that actually matters, `ghostscriptArgs()`.
 *
 * Two details make this work at all, neither obvious:
 *
 *  - `gs.js` is a UMD. Under `require()` it assigns `module.exports`, so the
 *    require call yields the factory directly - unlike `gs.mjs`, whose Node
 *    branch resolves the wasm through a `file://` URL that `fetch` rejects.
 *  - `instantiateWasm` bypasses Emscripten's own binary lookup. Without it the
 *    loader resolves gs.wasm against `document.currentScript` and fails
 *    outside a browser page.
 *
 * Verified: a vector-only PDF round-trips at rc=0 with a valid %PDF- header and
 * 37.7% saved, matching the browser path.
 */

type GsModule = {
    FS: {
        writeFile: (path: string, data: Uint8Array) => void;
        readFile: (path: string) => Uint8Array;
    };
    callMain: (args: string[]) => number;
};
type GsFactory = (opts: Record<string, unknown>) => Promise<GsModule>;

let factory: GsFactory | null = null;
/** Compiled once and reused: compiling 16 MB dwarfs instantiating it, and a
 *  fresh instance is needed per file because callMain is not re-entrant. */
let compiled: WebAssembly.Module | null = null;
/** The in-flight load, so two concurrent requests share one 16 MB compile
 *  instead of racing to do it twice. Cleared on failure so a retry can work. */
let loading: Promise<GsFactory> | null = null;

/** Walk up for node_modules so a hoisted or nested install both resolve, the
 *  same strategy the MCP fetch polyfill uses for the other WASM engines. */
async function resolvePackageDir(): Promise<string> {
    const path = await import("path");
    const fs = await import("fs");
    const { fileURLToPath } = await import("url");
    const rel = "@jspawn/ghostscript-wasm";

    let dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    for (;;) {
        const candidate = path.join(dir, "node_modules", rel);
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    throw new Error("Ghostscript WASM package not found. Run `bun install`.");
}

function loadOnce(): Promise<GsFactory> {
    if (factory && compiled) return Promise.resolve(factory);
    loading ??= readAndCompile().catch((e) => { loading = null; throw e; });
    return loading;
}

async function readAndCompile(): Promise<GsFactory> {
    const [{ createRequire }, fs, path] = await Promise.all([
        import("module"), import("fs"), import("path"),
    ]);
    const pkgDir = await resolvePackageDir();
    const require = createRequire(import.meta.url);

    factory = require(path.join(pkgDir, "gs.js")) as GsFactory;
    compiled = await WebAssembly.compile(await fs.promises.readFile(path.join(pkgDir, "gs.wasm")));
    return factory;
}

/** Emscripten's `instantiateWasm` hook offers no error channel: a rejection
 *  nobody listens for leaves the factory promise pending forever. Route it to
 *  the caller's reject so a failure surfaces as an error, not a hang. */
function instantiateWith(onError: (e: unknown) => void) {
    return (
        imports: WebAssembly.Imports,
        success: (inst: WebAssembly.Instance, mod: WebAssembly.Module) => void,
    ): Record<string, never> => {
        WebAssembly.instantiate(compiled!, imports).then(inst => success(inst, compiled!), onError);
        return {};
    };
}

function createModule(create: GsFactory): Promise<GsModule> {
    return new Promise<GsModule>((resolve, reject) => {
        create({
            noInitialRun: true,
            instantiateWasm: instantiateWith(reject),
            print: () => { /* -dQUIET still emits the odd line */ },
            printErr: () => { /* surfaced via the return code */ },
        }).then(resolve, reject);
    });
}

class GhostscriptNodeHandler implements FormatHandler {
    // Same name as the browser handler on purpose: `resolveCompressor` and the
    // conversion router look handlers up by name, and only one of the two is
    // ever present in a given registry.
    public name = "Ghostscript";

    // Kept in step with the browser handler's list on purpose - the agent
    // surfaces should not offer a different menu from the web UI.
    public supportedFormats: FileFormat[] = [
        CommonFormats.PDF.supported("pdf", true, true),
        CommonFormats.PS.supported("ps", true, true),
        CommonFormats.EPS.supported("eps", true, true),
        CommonFormats.AI.supported("ai", true, false),
        CommonFormats.PDFA.supported("pdfa", false, true),
        CommonFormats.TIFF.supported("tiff", false, true),
    ];

    public ready = false;
    public requiresMainThread = false;

    async init() {
        // Deliberately not loading here: a session that never touches a PDF
        // should not pay 16 MB of compile time at startup.
        this.ready = true;
    }

    async doConvert(
        inputFiles: FileData[],
        inputFormat: FileFormat,
        outputFormat: FileFormat,
        args?: string[],
    ): Promise<FileData[]> {
        const route = GS_OUTPUT_ROUTES[outputFormat.format];
        if (!route) {
            throw new Error(`Ghostscript can't write ${outputFormat.format.toUpperCase()}.`);
        }
        if (!GS_INPUT_FORMATS.has(inputFormat.format)) {
            throw new Error(`Ghostscript can't read ${inputFormat.format.toUpperCase()}.`);
        }

        // PDF in, PDF out is the compression pass; anything else is a format
        // change. Same split as the browser handler.
        const isCompression = inputFormat.format === "pdf" && outputFormat.format === "pdf";
        const quality = extractQualityPreset(args) ?? "medium";
        const create = await loadOnce();
        const outputs: FileData[] = [];

        for (const file of inputFiles) {
            if (!isCompression) {
                outputs.push(...await runGhostscriptConversion({
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

            Module.FS.writeFile("/in.pdf", file.bytes);
            const rc = Module.callMain(
                ghostscriptArgs({ quality, inputPath: "/in.pdf", outputPath: "/out.pdf" }));
            if (rc !== 0) {
                throw new Error(`Couldn't compress ${file.name}. The PDF may be corrupt or password-protected.`);
            }

            const bytes = Module.FS.readFile("/out.pdf");
            // Ghostscript can exit 0 having written something that is not a PDF.
            if (bytes.byteLength < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") {
                throw new Error(`Couldn't compress ${file.name}. The result wasn't a readable PDF.`);
            }
            outputs.push({ ...file, name: file.name, bytes });
        }

        return outputs;
    }
}

export default GhostscriptNodeHandler;
