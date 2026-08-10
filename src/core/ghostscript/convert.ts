import type { FileData, QualityPreset } from "../FormatHandler/FormatHandler.ts";
import { gsConvertArgs, needsPerPageOutput, type GsRoute } from "./args.ts";
import { detectPostScriptFlavour, wantsEpsCrop } from "./postscriptInput.ts";

/**
 * The conversion half of the Ghostscript handlers, shared by the browser and
 * Node siblings.
 *
 * Those two exist separately because they *load* the engine differently - over
 * HTTP with progress against straight off disk. What they do once it is loaded
 * is identical, and duplicating that was how the compression path and the
 * conversion path would drift apart. Everything here is engine-agnostic: it
 * asks for an instance through a callback and never knows where it came from.
 */

/** The slice of the Emscripten module both loaders expose. */
export type GsInstance = {
    FS: {
        writeFile: (path: string, data: Uint8Array) => void;
        readFile: (path: string) => Uint8Array;
    };
    callMain: (args: string[]) => number;
};

/** Which output formats this handler can produce, keyed by `format.format`. */
export const GS_OUTPUT_ROUTES: Record<string, GsRoute> = {
    pdf: "pdf",
    pdfa: "pdfa",
    ps: "ps",
    eps: "eps",
    tiff: "tiff",
};

/** Formats Ghostscript reads natively, keyed by `format.format`. */
export const GS_INPUT_FORMATS = new Set(["pdf", "ps", "eps", "ai"]);

/** Leading bytes each route's output must actually have. */
const OUTPUT_MAGIC: Record<GsRoute, string[]> = {
    pdf: ["%PDF-"],
    pdfa: ["%PDF-"],
    ps: ["%!"],
    eps: ["%!"],
    // TIFF is either byte order; both are real.
    tiff: ["II", "MM"],
};

/**
 * No real document has this many pages, and an unbounded loop against a
 * filesystem that answers by throwing is not something to leave open.
 */
const MAX_PER_PAGE_OUTPUTS = 5000;

function looksLike(bytes: Uint8Array, prefixes: string[]): boolean {
    const head = String.fromCharCode(...bytes.slice(0, 8));
    return prefixes.some(p => head.startsWith(p));
}

function stripExtension(name: string): string {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(0, dot) : name;
}

export type GsConversionRequest = {
    /** A fresh Emscripten instance. Called once - `callMain` is not re-entrant. */
    createInstance: () => Promise<GsInstance>;
    file: FileData;
    /** Lower-cased extension of the *input*, e.g. `eps`. Picks `-dEPSCrop`. */
    inputExtension: string;
    route: GsRoute;
    /** Output extension, e.g. `eps`. PDF/A writes `.pdf` like any other PDF. */
    outputExtension: string;
    quality: QualityPreset;
};

/**
 * Run one file through one route and return everything it produced.
 *
 * Returns an array because EPS legitimately fans out: one file per page, since
 * an EPS cannot hold more than one. Every other route returns exactly one file.
 */
export async function runGhostscriptConversion(req: GsConversionRequest): Promise<FileData[]> {
    const { createInstance, file, inputExtension, route, outputExtension, quality } = req;

    const flavour = detectPostScriptFlavour(file.bytes);
    const perPage = needsPerPageOutput(route);
    const inPath = `/in.${inputExtension || "dat"}`;
    // `%d` is Ghostscript's own page-number template, not a printf we format.
    const outPath = perPage ? `/out-%d.${outputExtension}` : `/out.${outputExtension}`;

    const Module = await createInstance();
    Module.FS.writeFile(inPath, file.bytes);

    const rc = Module.callMain(gsConvertArgs({
        route,
        inputPath: inPath,
        outputPath: outPath,
        quality,
        epsCrop: wantsEpsCrop(inputExtension, flavour),
    }));
    if (rc !== 0) {
        throw new Error(`Couldn't convert ${file.name}. The file may be corrupt or password-protected.`);
    }

    const base = stripExtension(file.name);
    const outputs: FileData[] = [];

    if (perPage) {
        // Ghostscript numbers from 1 and simply stops; the count is however many
        // files exist, which is only discoverable by reading until one is missing.
        for (let page = 1; page <= MAX_PER_PAGE_OUTPUTS; page++) {
            let bytes: Uint8Array;
            try {
                bytes = Module.FS.readFile(`/out-${page}.${outputExtension}`);
            } catch {
                break;
            }
            outputs.push({ ...file, name: `${base}_page_${page}.${outputExtension}`, bytes });
        }
        // A single-page source should not be handed back with a page suffix.
        if (outputs.length === 1) outputs[0].name = `${base}.${outputExtension}`;
    } else {
        let bytes: Uint8Array;
        try {
            bytes = Module.FS.readFile(`/out.${outputExtension}`);
        } catch {
            throw new Error(`Couldn't convert ${file.name}. Ghostscript produced no output.`);
        }
        outputs.push({ ...file, name: `${base}.${outputExtension}`, bytes });
    }

    if (outputs.length === 0) {
        throw new Error(`Couldn't convert ${file.name}. Ghostscript produced no output.`);
    }

    // Ghostscript exits 0 having written something unusable more often than is
    // comfortable - an empty file for an unreadable input, or the wrong device's
    // output entirely. The compression path already learned this; check here too
    // rather than handing the user a file that will not open.
    for (const out of outputs) {
        if (out.bytes.byteLength < 8 || !looksLike(out.bytes, OUTPUT_MAGIC[route])) {
            throw new Error(`Couldn't convert ${file.name}. The result wasn't a readable ${outputExtension.toUpperCase()}.`);
        }
    }

    return outputs;
}
