import type {
    FileData,
    FileFormat,
    ProgressEvent,
    QualityPreset,
} from "../FormatHandler/FormatHandler.ts";
import { withQualityArg } from "../FormatHandler/FormatHandler.ts";
import { resolveSameFormatHandler, handlerSupportsFormat, type HandlerOption } from "./resolveCompressor.ts";
import { decideAutoQuality } from "./automatic.ts";

/**
 * Batch compression orchestrator.
 *
 * The convert flow could assume one format for a whole run because the user
 * picks a single output format. The Compress surface can't: a batch is
 * whatever got dropped on it, so files are grouped by the handler that can
 * recompress them and each group runs as its own pass (a mixed drop may spin
 * up both ImageMagick and FFmpeg).
 *
 * Deliberately UI-free - it takes a `run` callback instead of importing the
 * worker client, so `src/core/` keeps no dependency on a surface.
 */

/**
 * One file to compress, with its bytes still on disk.
 *
 * `read()` rather than a `bytes` field because the caller used to load the
 * whole batch into memory before the first engine ran: peak usage was every
 * input at once, plus every output, plus the copy `runInWorker` transfers. That
 * is the real reason the surface capped batches at 500 MB, and it capped the
 * wrong thing - someone compressing one 800 MB video was refused to protect
 * against three of them.
 *
 * Read per file, inside the loop, the resident set is one input at a time.
 * Format detection never needed the bytes anyway; it reads name and MIME.
 */
export type CompressInput = {
    name: string;
    format: FileFormat;
    /** Known from the File handle, without reading it. */
    size: number;
    /** Called at most once, immediately before this file is compressed. */
    read: () => Promise<Uint8Array>;
};

/**
 * Why a file came back no smaller than it went in. "cancelled" is kept
 * distinct from "failed" because they are different news: one is the user's
 * own doing, the other is ours.
 */
export type SkipReason = "already-minimal" | "no-gain" | "unsupported" | "failed" | "cancelled";

export type CompressOutcome = {
    name: string;
    bytes: Uint8Array;
    /** Size before compression; equals bytes.byteLength when nothing was gained. */
    originalSize: number;
    /** True only when the output actually replaced the input. */
    shrunk: boolean;
    reason?: SkipReason;
    /**
     * Set when the primary engine was unreachable and a degraded route
     * produced this output. Carries the copy explaining what was lost, so the
     * surface never presents a lossy fallback as a normal success.
     */
    warning?: string;
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
    /**
     * Live progress from the engine itself - frame counts, page counts, the
     * ratio a video encoder reports as it works.
     *
     * `RunHandler` has declared this parameter since it was written, and the two
     * call sites below simply never passed it, so every engine that reports its
     * own progress was silenced on this surface. Six of them do: FFmpeg,
     * Ghostscript, comics, pdfCanvasCompress, pdftoimg and pdftotxt. That is why
     * compressing a large video showed one unchanging sentence for minutes.
     */
    onEngineProgress?: (p: ProgressEvent) => void;
    /**
     * Called when a handler has to be initialised before it can run, with the
     * engine's own name. Loading one means fetching and compiling a WASM binary
     * - 32 MB for FFmpeg, 16 MB for Ghostscript, 14 MB for ImageMagick - and the
     * surface used to sit on "Reading your file..." throughout, which is both
     * untrue and the single longest unexplained wait in the app.
     */
    onEngineInit?: (handlerName: string, format: FileFormat) => void;
    /**
     * Called immediately before a file's bytes are read off disk. The read is
     * where "Reading your file..." actually belongs; it used to be shown before
     * the engine load instead, one phase too early.
     */
    onFileRead?: (name: string) => void;
    /**
     * Called once the bytes are in hand and the engine is about to run.
     *
     * Separate from {@link onFileRead} because the surface has to be able to
     * leave the "Reading..." wording behind even for the ~76 handlers that
     * report no progress of their own. Without it, compressing with ImageMagick
     * would sit on "Reading your file..." for the entire compression.
     */
    onFileCompress?: (name: string) => void;
    isCancelled?: () => boolean;
};

/**
 * Keeping a compressed result only when it saves at least 2% avoids handing
 * back a re-encoded file that is the same size but has lost quality. Exported
 * so the PDF editor's optional output compression applies the identical rule
 * rather than inventing a second, slightly different one.
 */
export const KEEP_THRESHOLD = 0.98;

/**
 * Below this, a file is essentially all container overhead - a PNG's signature,
 * IHDR and IEND alone are ~70 bytes. Re-encoding cannot claw back the 2% the
 * keep-threshold wants, and some engines simply error on such degenerate input.
 * Reporting "already as small as it gets" is both true and more useful than the
 * "failed" the thrown error would otherwise produce.
 */
const MIN_COMPRESSIBLE_BYTES = 512;

/** Shared zero-length view for outcomes whose file was never read. */
const EMPTY = new Uint8Array(0);

function groupKey(format: FileFormat): string {
    return `${(format.mime || "").toLowerCase()}|${(format.format || "").toLowerCase()}`;
}

export async function compressBatch(
    inputs: readonly CompressInput[],
    opts: CompressBatchOptions,
): Promise<CompressOutcome[]> {
    const {
        options, level, run, onProgress,
        onEngineProgress, onEngineInit, onFileRead, onFileCompress,
        isCancelled,
    } = opts;

    // Preserve input order in the results regardless of grouping.
    const results = new Map<number, CompressOutcome>();
    /**
     * Hand a file back unchanged.
     *
     * `bytes` is whatever we happen to already hold. For a file we never
     * compressed - one we cannot handle, or one the user stopped us before
     * reaching - that is nothing, and it stays nothing: reading a file off disk
     * purely to hand back bytes identical to the ones already on disk is work
     * nobody asked for, and in the cancelled case it is work they explicitly
     * asked us to stop doing. The surface reports the file and its reason
     * either way; it just does not put an untouched copy in the download.
     */
    const passthrough = (
        i: number, input: CompressInput, reason: SkipReason, bytes: Uint8Array = EMPTY,
    ) => {
        results.set(i, {
            name: input.name,
            bytes,
            originalSize: input.size,
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
            // Decided from the format alone, so this costs no disk read at all.
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

        // One init per group rather than per file - the WASM load is the
        // expensive part and a mixed batch may need more than one engine.
        let ready = handler.ready;
        if (!ready) {
            // Say so before the wait, not after it. This is the 32 MB download.
            onEngineInit?.(handler.name, group.format);
            try {
                await handler.init();
                ready = handler.ready;
                // Browser-only cache; see handlerSupportsFormat. Guarded because
                // MCP and REST run this same batch with no window at all, and
                // this line only fires for a handler that was lazily
                // initialised - so it would have thrown later and elsewhere
                // than the identical bug in the resolver.
                if (ready && handler.supportedFormats && typeof window !== "undefined") {
                    window.supportedFormatCache?.set(handler.name, handler.supportedFormats);
                }
            } catch (e) {
                console.error(handler.name, "compress init failed", e);
            }
        }

        // Same format in, same format out - that is what "compress" means
        // here, so there is only ever one format to resolve.
        const inFmt = ready ? handlerSupportsFormat(handler, group.format) : null;
        if (!ready || !inFmt) {
            for (const { index, input } of group.items) passthrough(index, input, "unsupported");
            done += group.items.length;
            continue;
        }

        for (const { index, input } of group.items) {
            if (isCancelled?.()) break;
            onProgress?.(done, total, input.name);

            // Decided from the declared size, before any read: a file this
            // small cannot claw back the 2% the keep-threshold wants.
            if (input.size < MIN_COMPRESSIBLE_BYTES) {
                passthrough(index, input, "already-minimal");
                done++;
                continue;
            }

            // The one read. Everything above this line is decided from metadata,
            // so the resident set is a single file at a time however large the
            // batch is. A file moved or deleted between picking and compressing
            // rejects here - ordinary behaviour, not an edge case.
            let bytes: Uint8Array;
            onFileRead?.(input.name);
            try {
                bytes = await input.read();
            } catch (e) {
                console.error("[compress] couldn't read", input.name, e);
                passthrough(index, input, "failed");
                done++;
                continue;
            }

            // The probe *chooses* a tier when the user hasn't. It must never
            // overrule one they did choose: it reads container metadata, not
            // pixels, so "already as small as it gets" is a guess - and a guess
            // is no basis for refusing to run. Someone who picked "Smallest
            // file" has asked us to try, and we can only report back honestly
            // once we have. KEEP_THRESHOLD below is the real guard against
            // handing back a re-encode that gained nothing; it measures the
            // output instead of predicting it.
            //
            // This veto used to fire for every level, and it is why image-heavy
            // PDFs came back untouched at every setting.
            let effective: QualityPreset = level === "auto" ? "medium" : level;
            if (level === "auto") {
                // See `automatic.ts` for what Automatic means. Compress is the
                // one surface that can honour "already minimal" literally: it
                // hands the file back untouched, because the user asked for a
                // smaller file and there isn't one to give.
                const decision = await decideAutoQuality(bytes, input.format.mime ?? "");
                if (decision.kind === "already-minimal") {
                    passthrough(index, input, "already-minimal", bytes);
                    done++;
                    continue;
                }
                effective = decision.tier;
            }

            const perFileArgs = withQualityArg(args, effective);
            const originalSize = bytes.byteLength;
            const fileData: FileData = { name: input.name, bytes };
            // Bytes are in hand; from here the engine is doing the work.
            onFileCompress?.(input.name);

            const attempt = async (h: typeof handler, a: string[]) => {
                // Resolve the format against the handler that will actually run
                // it. The group's inFmt came from the primary, and a fallback is
                // a different handler with its own declared list - reusing the
                // primary's entry only works while the two happen to agree.
                const fmt = h === handler ? inFmt : (handlerSupportsFormat(h, group.format) ?? inFmt);
                const produced = h.requiresMainThread
                    ? await h.doConvert([fileData], fmt, fmt, a, onEngineProgress)
                    : await run(h.name, [fileData], fmt, fmt, a, onEngineProgress);
                return produced?.length && produced[0].bytes.byteLength > 0 ? produced[0] : null;
            };

            let output: FileData | null = null;
            let warning: string | undefined;
            try {
                output = await attempt(handler, perFileArgs);
            } catch (e) {
                if (!isCancelled?.()) console.error(handler.name, "compression threw", e);
                // The primary engine could not run. A declared fallback is
                // worse but better than handing the file back untouched, so
                // try it - and remember to say what it cost.
                const fb = group.dispatch.fallback;
                if (fb && !isCancelled?.()) {
                    try {
                        // The group-level init only ran for the primary, so this
                        // is a second engine load and deserves the same notice.
                        if (!fb.handler.ready) {
                            onEngineInit?.(fb.handler.name, group.format);
                            await fb.handler.init();
                        }
                        output = await attempt(fb.handler, withQualityArg(fb.args, effective));
                        if (output) warning = fb.warning;
                    } catch (e2) {
                        console.error(fb.handler.name, "fallback compression threw", e2);
                    }
                }
            }

            if (output && output.bytes.byteLength < originalSize * KEEP_THRESHOLD) {
                results.set(index, {
                    name: input.name,
                    bytes: output.bytes,
                    originalSize,
                    shrunk: true,
                    warning,
                });
            } else if (!output && isCancelled?.()) {
                // Stop terminated the worker mid-file, so this attempt rejected
                // because the user asked it to. Reporting it "failed" would
                // blame us for their decision, and it is the *likeliest* file
                // to be interrupted - the big one they pressed Stop over.
                passthrough(index, input, "cancelled", bytes);
                break;
            } else {
                // A fallback that produced nothing useful is not worth
                // explaining - the file is unchanged either way.
                passthrough(index, input, output ? "no-gain" : "failed", bytes);
            }
            done++;
        }
        if (isCancelled?.()) break;
    }

    // Anything that never got a result is reported untouched. Stopping early is
    // the overwhelmingly likely reason, and telling someone who pressed Stop
    // that their files "failed" is both wrong and alarming.
    const stopped = isCancelled?.() ?? false;
    inputs.forEach((input, index) => {
        if (!results.has(index)) passthrough(index, input, stopped ? "cancelled" : "failed");
    });

    return inputs.map((_, i) => results.get(i)!);
}

/** Total bytes saved across a finished batch. */
export function totalSaved(outcomes: readonly CompressOutcome[]): number {
    return outcomes.reduce((sum, o) => sum + (o.shrunk ? o.originalSize - o.bytes.byteLength : 0), 0);
}
