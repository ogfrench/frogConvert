import type {
    FileData,
    FileFormat,
    ProgressEvent,
    QualityPreset,
} from "../FormatHandler/FormatHandler.ts";
import { withQualityArg } from "../FormatHandler/FormatHandler.ts";
import { resolveSameFormatHandler, handlerSupportsFormat, type HandlerOption } from "./resolveCompressor.ts";
import { probeInputQuality } from "./inputQuality.ts";
import { tierDown } from "./tierDown.ts";

/**
 * Batch compression orchestrator.
 *
 * The convert flow could assume one format for a whole run because the user
 * picks a single output format. The Compress surface can't: a batch is
 * whatever got dropped on it, so files are grouped by the handler that can
 * recompress them and each group runs as its own pass (a mixed drop may spin
 * up both ImageMagick and FFmpeg).
 *
 * Deliberately UI-free — it takes a `run` callback instead of importing the
 * worker client, so `src/core/` keeps no dependency on a surface.
 */

export type CompressInput = {
    name: string;
    bytes: Uint8Array;
    format: FileFormat;
};

/** Why a file came back no smaller than it went in. */
export type SkipReason = "already-minimal" | "no-gain" | "unsupported" | "failed";

export type CompressOutcome = {
    name: string;
    bytes: Uint8Array;
    /** Size before compression; equals bytes.byteLength when nothing was gained. */
    originalSize: number;
    /** True only when the output actually replaced the input. */
    shrunk: boolean;
    reason?: SkipReason;
};

export type RunHandler = (
    handlerName: string,
    files: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat,
    args: string[],
    onProgress?: (p: ProgressEvent) => void,
) => Promise<FileData[]>;

export type CompressBatchOptions = {
    /** The app's loaded handler/format list (`allOptionsRef.value`). */
    options: readonly HandlerOption[];
    /**
     * User-chosen target, or "auto" to let each file pick its own: the input
     * is probed and its detected quality decides the output tier, so a file
     * that's already small isn't crushed again.
     */
    level: QualityPreset | "auto";
    /** Off-main-thread runner. Main-thread-only handlers bypass it. */
    run: RunHandler;
    onProgress?: (done: number, total: number, current: string) => void;
    isCancelled?: () => boolean;
};

/**
 * Keeping a compressed result only when it saves at least 2% avoids handing
 * back a re-encoded file that is the same size but has lost quality.
 */
const KEEP_THRESHOLD = 0.98;

function groupKey(format: FileFormat): string {
    return `${(format.mime || "").toLowerCase()}|${(format.format || "").toLowerCase()}`;
}

export async function compressBatch(
    inputs: readonly CompressInput[],
    opts: CompressBatchOptions,
): Promise<CompressOutcome[]> {
    const { options, level, run, onProgress, isCancelled } = opts;

    // Preserve input order in the results regardless of grouping.
    const results = new Map<number, CompressOutcome>();
    const passthrough = (i: number, input: CompressInput, reason: SkipReason) => {
        results.set(i, {
            name: input.name,
            bytes: input.bytes,
            originalSize: input.bytes.byteLength,
            shrunk: false,
            reason,
        });
    };

    // --- Group by the handler that can recompress each format ---
    type Group = {
        dispatch: NonNullable<ReturnType<typeof resolveSameFormatHandler>>;
        format: FileFormat;
        items: { index: number; input: CompressInput }[];
    };
    const groups = new Map<string, Group>();

    inputs.forEach((input, index) => {
        const dispatch = resolveSameFormatHandler(input.format, options);
        if (!dispatch) {
            passthrough(index, input, "unsupported");
            return;
        }
        const key = groupKey(input.format);
        const existing = groups.get(key);
        if (existing) existing.items.push({ index, input });
        else groups.set(key, { dispatch, format: input.format, items: [{ index, input }] });
    });

    let done = 0;
    const total = inputs.length;

    for (const group of groups.values()) {
        if (isCancelled?.()) break;
        const { handler, args } = group.dispatch;

        // One init per group rather than per file — the WASM load is the
        // expensive part and a mixed batch may need more than one engine.
        let ready = handler.ready;
        if (!ready) {
            try {
                await handler.init();
                ready = handler.ready;
                if (ready && handler.supportedFormats) {
                    window.supportedFormatCache?.set(handler.name, handler.supportedFormats);
                }
            } catch (e) {
                console.error(handler.name, "compress init failed", e);
            }
        }

        const inFmt = ready ? handlerSupportsFormat(handler, group.format) : null;
        const outFmt = inFmt;
        if (!ready || !inFmt || !outFmt) {
            for (const { index, input } of group.items) passthrough(index, input, "unsupported");
            done += group.items.length;
            continue;
        }

        for (const { index, input } of group.items) {
            if (isCancelled?.()) break;
            onProgress?.(done, total, input.name);

            // Probe unless the caller asked for something the probe can't
            // improve on. Two things come out of it: whether the input is
            // already at minimum useful quality (re-encoding it would trade
            // visible quality for ~no bytes), and - under "auto" - which tier
            // this particular file deserves.
            let effective: QualityPreset = level === "auto" ? "medium" : level;
            if (level !== "lossless") {
                const probe = await probeInputQuality(input.bytes, input.format.mime ?? "");
                const next = tierDown(probe.inputTier);
                if (next.kind === "skip") {
                    passthrough(index, input, "already-minimal");
                    done++;
                    continue;
                }
                if (level === "auto") effective = next.tier;
            }

            const perFileArgs = withQualityArg(args, effective);
            const originalSize = input.bytes.byteLength;
            let output: FileData | null = null;
            try {
                const fileData: FileData = { name: input.name, bytes: input.bytes };
                const produced = handler.requiresMainThread
                    ? await handler.doConvert([fileData], inFmt, outFmt, perFileArgs)
                    : await run(handler.name, [fileData], inFmt, outFmt, perFileArgs);
                if (produced?.length && produced[0].bytes.byteLength > 0) output = produced[0];
            } catch (e) {
                if (!isCancelled?.()) console.error(handler.name, "compression threw", e);
            }

            if (output && output.bytes.byteLength < originalSize * KEEP_THRESHOLD) {
                results.set(index, {
                    name: input.name,
                    bytes: output.bytes,
                    originalSize,
                    shrunk: true,
                });
            } else {
                passthrough(index, input, output ? "no-gain" : "failed");
            }
            done++;
        }
    }

    // Anything cancelled mid-flight never got a result; report it untouched.
    inputs.forEach((input, index) => {
        if (!results.has(index)) passthrough(index, input, "failed");
    });

    return inputs.map((_, i) => results.get(i)!);
}

/** Total bytes saved across a finished batch. */
export function totalSaved(outcomes: readonly CompressOutcome[]): number {
    return outcomes.reduce((sum, o) => sum + (o.shrunk ? o.originalSize - o.bytes.byteLength : 0), 0);
}
