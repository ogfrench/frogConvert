import type { FileData, FormatHandler, QualityPreset } from "../FormatHandler/FormatHandler.ts";
import type { HandlerOption } from "./resolveCompressor.ts";
import { compressBatch, type CompressOutcome } from "./compressBatch.ts";

/**
 * Compression for the agent surfaces: MCP, REST and the CLI.
 *
 * ## Why this exists
 *
 * The documented way to compress from an agent used to be "ask `convert_file`
 * for the same format in and out". That never worked. A same-format request
 * resolves to a **zero-hop path**, and the conversion loop is
 * `for (let i = 1; i < path.length; i++)` - so it never runs a single step and
 * hands the input straight back. Measured: a 10 MB image-heavy PDF came back
 * byte-identical at every level, while the browser shrank the same file
 * substantially. The "size guard" the docs credited for that was vacuous;
 * nothing had been produced to guard.
 *
 * So compression gets its own entry point rather than being a special case of
 * conversion, which is also what the web UI concluded when it grew a separate
 * Compress surface.
 *
 * ## What it reuses
 *
 * Everything that matters: `compressBatch` picks the engine per format, honours
 * `auto` per file, applies the 98% keep-threshold, and reports a reason when a
 * file is not shrunk. Routing agents through it is what stops the two surfaces
 * from drifting - a new format rule or a fixed defect reaches both at once.
 */

export type AgentCompressInput = {
    name: string;
    bytes: Uint8Array;
    /** MIME of the file, e.g. `image/jpeg`. Used to find the compressor. */
    mime: string;
    /** Extension without the dot, e.g. `jpg`. Disambiguates shared MIMEs. */
    extension: string;
};

export type AgentCompressResult = {
    name: string;
    bytes: Uint8Array;
    originalSize: number;
    shrunk: boolean;
    /** Present when the file was not shrunk; says why, in the UI's vocabulary. */
    reason?: string;
    /** Set when a degraded engine produced this, with what it cost. */
    warning?: string;
};

/** Look up the format entry a handler declares for this file. */
function findOption(
    handlers: readonly FormatHandler[],
    mime: string,
    extension: string,
): HandlerOption | undefined {
    const ext = extension.toLowerCase().replace(/^\./, "");
    for (const handler of handlers) {
        for (const format of handler.supportedFormats ?? []) {
            if (format.mime !== mime) continue;
            if (format.extension.toLowerCase() !== ext && format.format.toLowerCase() !== ext) continue;
            return { format, handler };
        }
    }
    return undefined;
}

/**
 * Build the option list `compressBatch` needs. It resolves the same-format
 * compressor itself, so it wants every handler/format pair, not just the one
 * matching the input.
 */
export function agentCompressOptions(handlers: readonly FormatHandler[]): HandlerOption[] {
    const options: HandlerOption[] = [];
    for (const handler of handlers) {
        for (const format of handler.supportedFormats ?? []) options.push({ format, handler });
    }
    return options;
}

export type AgentCompressOptions = {
    handlers: readonly FormatHandler[];
    /** `auto` matches the web UI's default: probe each file and pick its tier. */
    level: QualityPreset | "auto";
};

/**
 * Compress one or more files and report honestly on each.
 *
 * Never throws for a file it could not shrink: a per-file `reason` is more
 * useful to a script than an exception that loses the rest of the batch.
 */
export async function compressForAgents(
    inputs: readonly AgentCompressInput[],
    opts: AgentCompressOptions,
): Promise<AgentCompressResult[]> {
    const options = agentCompressOptions(opts.handlers);

    const batchInputs = inputs.map(input => {
        const match = findOption(opts.handlers, input.mime, input.extension);
        return {
            name: input.name,
            // An unknown format still needs a FileFormat to travel through the
            // batch; compressBatch will report it as unsupported rather than
            // guessing at an engine for it.
            format: match?.format ?? {
                name: input.extension.toUpperCase(),
                format: input.extension,
                extension: input.extension,
                mime: input.mime,
                internal: input.extension,
                from: true,
                to: true,
                lossless: false,
            },
            size: input.bytes.byteLength,
            read: async () => input.bytes,
        };
    });

    const outcomes: CompressOutcome[] = await compressBatch(batchInputs, {
        options,
        level: opts.level,
        // No worker here: the agent surfaces are already off any UI thread, so
        // the handler is called directly rather than posted somewhere.
        //
        // Looked up by the name `compressBatch` resolved, not by matching the
        // format object. `handlerSupportsFormat` can return a *synthesised*
        // entry - it merges FFmpeg's separate demuxer and muxer rows into one
        // `{...writable, from: true, to: true}` - so the format arriving here
        // is often not the object in `options`, and identity comparison would
        // silently fail for exactly the video and audio formats that were
        // hardest to get working in the first place.
        run: async (handlerName, files: FileData[], inFmt, outFmt, args) => {
            const handler = opts.handlers.find(h => h.name === handlerName);
            if (!handler) throw new Error(`No handler named ${handlerName}`);
            return handler.doConvert(files, inFmt, outFmt, args);
        },
    });

    // A file that was not shrunk must come back as the bytes that were sent.
    //
    // `compressBatch` does not always supply them. When it can decide from the
    // format or the declared size alone - unsupported format, engine missing,
    // file under the minimum - it skips the read entirely and returns an empty
    // array. That is right for the browser, which still holds the file and only
    // needs to be told nothing happened. It is wrong here: an agent sent its
    // bytes over a socket and has nothing to fall back on, so empty means the
    // file is gone. Left unhandled, `compress_file` writes a **zero-byte file**
    // over its output path and reports it as a 100% saving.
    //
    // The inputs are index-aligned with the outcomes (`compressBatch` returns
    // `inputs.map((_, i) => results.get(i)!)`), so the original is always to
    // hand. For the outcomes that *do* carry bytes when unshrunk, those bytes
    // are the original anyway, which is why this can key off `shrunk` alone.
    return outcomes.map((o, i) => ({
        name: o.name,
        bytes: o.shrunk ? o.bytes : inputs[i]!.bytes,
        originalSize: o.originalSize,
        shrunk: o.shrunk,
        reason: o.reason,
        warning: o.warning,
    }));
}
