import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FileFormat, FormatHandler } from "../FormatHandler/FormatHandler.ts";

vi.mock("./inputQuality.ts", () => ({ probeInputQuality: vi.fn(async () => ({ inputTier: "hq" })) }));
vi.mock("./tierDown.ts", () => ({ tierDown: vi.fn(() => ({ kind: "tier", tier: "medium" })) }));
vi.mock("./resolveCompressor.ts", () => ({
    resolveSameFormatHandler: vi.fn(),
    handlerSupportsFormat: vi.fn((_h: unknown, f: FileFormat) => f),
}));

const { compressBatch, totalSaved } = await import("./compressBatch.ts");
import { resolveSameFormatHandler } from "./resolveCompressor.ts";
import { probeInputQuality } from "./inputQuality.ts";
import { tierDown } from "./tierDown.ts";

const resolveMock = vi.mocked(resolveSameFormatHandler);
const tierDownMock = vi.mocked(tierDown);
const probeMock = vi.mocked(probeInputQuality);

(globalThis as any).window = { supportedFormatCache: new Map() };

function fmt(mime: string, format: string): FileFormat {
    return { mime, format, extension: format, from: true, to: true } as unknown as FileFormat;
}

function handler(name: string, opts: { mainThread?: boolean } = {}): FormatHandler {
    return {
        name,
        ready: true,
        init: vi.fn(async () => {}),
        requiresMainThread: !!opts.mainThread,
        supportedFormats: [],
        doConvert: vi.fn(),
    } as unknown as FormatHandler;
}

/**
 * Inputs are lazy: `compressBatch` reads each file at the moment it compresses
 * it, so a batch is never all resident at once. `read` here is instrumented so
 * tests can assert *that a file was never opened* - which is the whole point of
 * deciding "unsupported" and "too small to bother" from metadata alone.
 */
function input(name: string, size: number, format: FileFormat) {
    const bytes = new Uint8Array(size);
    const read = vi.fn(async () => bytes);
    return { name, format, size, read };
}

/** A runner that shrinks output to `ratio` of the input. */
const shrinkingRun = (ratio: number) =>
    vi.fn(async (_n: string, files: any[]) => [
        { name: files[0].name, bytes: new Uint8Array(Math.floor(files[0].bytes.byteLength * ratio)) },
    ]);

beforeEach(() => {
    vi.clearAllMocks();
    tierDownMock.mockReturnValue({ kind: "tier", tier: "medium" } as any);
    probeMock.mockResolvedValue({ inputTier: "hq" } as any);
});

describe("compressBatch - grouping", () => {
    it("runs one pass per format group and reuses each handler", async () => {
        const im = handler("ImageMagick");
        const ff = handler("FFmpeg");
        const png = fmt("image/png", "png");
        const mp4 = fmt("video/mp4", "mp4");
        resolveMock.mockImplementation((f: FileFormat) =>
            f.mime === "image/png"
                ? { handler: im, args: ["--quality", "medium"] }
                : { handler: ff, args: ["--quality", "medium"] });

        const run = shrinkingRun(0.5);
        const out = await compressBatch(
            [input("a.png", 1000, png), input("b.mp4", 2000, mp4), input("c.png", 1000, png)],
            { options: [], level: "medium", run },
        );

        expect(out).toHaveLength(3);
        expect(out.every(o => o.shrunk)).toBe(true);
        // Three files, three runs - but grouped so each engine is touched once per group.
        expect(run).toHaveBeenCalledTimes(3);
        const handlersUsed = run.mock.calls.map(c => c[0]);
        expect(handlersUsed).toEqual(["ImageMagick", "ImageMagick", "FFmpeg"]);
    });

    it("preserves input order in the results despite grouping", async () => {
        const im = handler("ImageMagick");
        const ff = handler("FFmpeg");
        resolveMock.mockImplementation((f: FileFormat) =>
            f.mime.startsWith("image/")
                ? { handler: im, args: [] }
                : { handler: ff, args: [] });

        const out = await compressBatch(
            [
                input("first.png", 1000, fmt("image/png", "png")),
                input("second.mp4", 1000, fmt("video/mp4", "mp4")),
                input("third.png", 1000, fmt("image/png", "png")),
            ],
            { options: [], level: "medium", run: shrinkingRun(0.5) },
        );

        expect(out.map(o => o.name)).toEqual(["first.png", "second.mp4", "third.png"]);
    });
});

describe("compressBatch - per-file outcomes", () => {
    it("keeps the original when the result is not meaningfully smaller", async () => {
        resolveMock.mockReturnValue({ handler: handler("ImageMagick"), args: [] });
        const out = await compressBatch(
            [input("a.png", 1000, fmt("image/png", "png"))],
            { options: [], level: "medium", run: shrinkingRun(0.99) },
        );
        expect(out[0].shrunk).toBe(false);
        expect(out[0].reason).toBe("no-gain");
        expect(out[0].bytes.byteLength).toBe(1000);
    });

    it("marks formats with no compressor as unsupported and passes them through", async () => {
        resolveMock.mockReturnValue(null);
        const run = shrinkingRun(0.5);
        const out = await compressBatch(
            [input("a.svg", 500, fmt("image/svg+xml", "svg"))],
            { options: [], level: "medium", run },
        );
        expect(out[0].reason).toBe("unsupported");
        expect(out[0].shrunk).toBe(false);
        expect(run).not.toHaveBeenCalled();
    });

    it("skips files already at minimum useful quality under auto", async () => {
        resolveMock.mockReturnValue({ handler: handler("ImageMagick"), args: [] });
        tierDownMock.mockReturnValue({ kind: "skip" } as any);
        const run = shrinkingRun(0.5);
        const out = await compressBatch(
            [input("tiny.jpg", 900, fmt("image/jpeg", "jpeg"))],
            { options: [], level: "auto", run },
        );
        expect(out[0].reason).toBe("already-minimal");
        expect(run).not.toHaveBeenCalled();
    });

    // The probe reads container metadata, not pixels. Letting it refuse a level
    // the user picked by hand is how image-heavy PDFs came back untouched at
    // every setting: they measured ~100 kB/page and were called "minimal".
    it("never lets the probe veto an explicitly chosen level", async () => {
        resolveMock.mockReturnValue({ handler: handler("Ghostscript"), args: [] });
        tierDownMock.mockReturnValue({ kind: "skip" } as any);
        const run = shrinkingRun(0.5);
        const out = await compressBatch(
            [input("report.pdf", 6_000_000, fmt("application/pdf", "pdf"))],
            { options: [], level: "low", run },
        );
        expect(run).toHaveBeenCalled();
        expect(out[0].shrunk).toBe(true);
    });

    it("does not even probe when the level is explicit", async () => {
        resolveMock.mockReturnValue({ handler: handler("ImageMagick"), args: [] });
        await compressBatch(
            [input("a.png", 1000, fmt("image/png", "png"))],
            { options: [], level: "high", run: shrinkingRun(0.5) },
        );
        expect(probeMock).not.toHaveBeenCalled();
    });

    it("keeps the original when the handler throws", async () => {
        resolveMock.mockReturnValue({ handler: handler("ImageMagick"), args: [] });
        const run = vi.fn(async () => { throw new Error("boom"); });
        const out = await compressBatch(
            [input("a.png", 1000, fmt("image/png", "png"))],
            { options: [], level: "medium", run },
        );
        expect(out[0].reason).toBe("failed");
        expect(out[0].bytes.byteLength).toBe(1000);
    });
});

describe("compressBatch - level handling", () => {
    it("uses the user's level rather than the auto tier-down", async () => {
        resolveMock.mockReturnValue({ handler: handler("ImageMagick"), args: ["--quality", "medium"] });
        // tierDown would say "medium"; the user asked for the most aggressive.
        const run = shrinkingRun(0.5);
        await compressBatch(
            [input("a.png", 1000, fmt("image/png", "png"))],
            { options: [], level: "low", run },
        );
        expect(run.mock.calls[0][4]).toEqual(["--quality", "low"]);
    });

    it("does not probe at all for lossless", async () => {
        resolveMock.mockReturnValue({ handler: handler("ImageMagick"), args: [] });
        await compressBatch(
            [input("a.png", 1000, fmt("image/png", "png"))],
            { options: [], level: "lossless", run: shrinkingRun(0.5) },
        );
        expect(probeMock).not.toHaveBeenCalled();
    });
});

describe("compressBatch - main-thread handlers", () => {
    it("bypasses the worker runner when the handler requires the main thread", async () => {
        const h = handler("MainThready", { mainThread: true });
        vi.mocked(h.doConvert).mockResolvedValue([{ name: "a.png", bytes: new Uint8Array(100) }] as any);
        resolveMock.mockReturnValue({ handler: h, args: [] });
        const run = shrinkingRun(0.5);

        const out = await compressBatch(
            [input("a.png", 1000, fmt("image/png", "png"))],
            { options: [], level: "medium", run },
        );

        expect(run).not.toHaveBeenCalled();
        expect(h.doConvert).toHaveBeenCalled();
        expect(out[0].shrunk).toBe(true);
    });
});

describe("compressBatch - cancellation", () => {
    it("stops early and reports untouched files", async () => {
        resolveMock.mockReturnValue({ handler: handler("ImageMagick"), args: [] });
        let calls = 0;
        const run = vi.fn(async (_n: string, files: any[]) => {
            calls++;
            return [{ name: files[0].name, bytes: new Uint8Array(10) }];
        });
        const out = await compressBatch(
            [
                input("a.png", 1000, fmt("image/png", "png")),
                input("b.png", 1000, fmt("image/png", "png")),
                input("c.png", 1000, fmt("image/png", "png")),
            ],
            { options: [], level: "medium", run, isCancelled: () => calls >= 1 },
        );
        expect(run).toHaveBeenCalledTimes(1);
        expect(out).toHaveLength(3);
        expect(out[1].shrunk).toBe(false);
    });

    it("marks files it never reached as cancelled, not failed", async () => {
        // The user pressed Stop. Telling them their files "failed" blames us
        // for something they asked for, and reads like data loss.
        resolveMock.mockReturnValue({ handler: handler("ImageMagick"), args: [] });
        let calls = 0;
        const run = vi.fn(async (_n: string, files: any[]) => {
            calls++;
            return [{ name: files[0].name, bytes: new Uint8Array(10) }];
        });
        const out = await compressBatch(
            [
                input("a.png", 1000, fmt("image/png", "png")),
                input("b.png", 1000, fmt("image/png", "png")),
            ],
            { options: [], level: "medium", run, isCancelled: () => calls >= 1 },
        );
        expect(out[1].reason).toBe("cancelled");
    });

    it("still says failed when nothing was cancelled", async () => {
        // The same sweep catches genuine gaps; those must not be softened into
        // "cancelled" or a real bug would hide behind reassuring copy.
        resolveMock.mockReturnValue({ handler: handler("ImageMagick"), args: [] });
        const run = vi.fn(async () => { throw new Error("engine died"); });
        const out = await compressBatch(
            [input("a.png", 1000, fmt("image/png", "png"))],
            { options: [], level: "medium", run },
        );
        expect(out[0].reason).toBe("failed");
    });
});

describe("totalSaved", () => {
    it("sums only the files that actually shrank", () => {
        expect(totalSaved([
            { name: "a", bytes: new Uint8Array(400), originalSize: 1000, shrunk: true },
            { name: "b", bytes: new Uint8Array(500), originalSize: 500, shrunk: false, reason: "no-gain" },
        ])).toBe(600);
    });
});

describe("compressBatch - automatic level", () => {
    it("lets each file's own detected quality pick its tier", async () => {
        resolveMock.mockReturnValue({ handler: handler("ImageMagick"), args: ["--quality", "medium"] });
        // The probe says this input warrants "low"; auto should honour that
        // rather than falling back to a fixed tier.
        tierDownMock.mockReturnValue({ kind: "tier", tier: "low" } as any);
        const run = shrinkingRun(0.5);

        await compressBatch(
            [input("a.png", 1000, fmt("image/png", "png"))],
            { options: [], level: "auto", run },
        );

        expect(run.mock.calls[0][4]).toEqual(["--quality", "low"]);
    });

    it("still refuses to re-crush a file that is already minimal", async () => {
        resolveMock.mockReturnValue({ handler: handler("ImageMagick"), args: [] });
        tierDownMock.mockReturnValue({ kind: "skip" } as any);
        const run = shrinkingRun(0.5);

        const out = await compressBatch(
            [input("tiny.jpg", 900, fmt("image/jpeg", "jpeg"))],
            { options: [], level: "auto", run },
        );

        expect(out[0].reason).toBe("already-minimal");
        expect(run).not.toHaveBeenCalled();
    });

    it("differs from a fixed level: two files can get different tiers", async () => {
        resolveMock.mockReturnValue({ handler: handler("ImageMagick"), args: [] });
        tierDownMock
            .mockReturnValueOnce({ kind: "tier", tier: "low" } as any)
            .mockReturnValueOnce({ kind: "tier", tier: "high" } as any);
        const run = shrinkingRun(0.5);

        await compressBatch(
            [
                input("a.png", 1000, fmt("image/png", "png")),
                input("b.png", 1000, fmt("image/png", "png")),
            ],
            { options: [], level: "auto", run },
        );

        expect(run.mock.calls[0][4]).toEqual(["--quality", "low"]);
        expect(run.mock.calls[1][4]).toEqual(["--quality", "high"]);
    });
});

describe("compressBatch - degraded fallback", () => {
    const png = fmt("image/png", "png");

    it("uses the fallback when the primary engine cannot run, and says what it cost", async () => {
        const primary = handler("Ghostscript");
        const alt = handler("PdfCanvasCompress", { mainThread: true });
        vi.mocked(alt.doConvert).mockResolvedValue(
            [{ name: "a.pdf", bytes: new Uint8Array(300) }] as any);
        resolveMock.mockReturnValue({
            handler: primary,
            args: [],
            fallback: { handler: alt, args: [], warning: "pages became images" },
        } as any);
        // Primary is worker-routed and blows up (e.g. the payload 404s).
        const run = vi.fn(async () => { throw new Error("offline"); });

        const out = await compressBatch(
            [input("a.pdf", 1000, png)],
            { options: [], level: "medium", run },
        );

        expect(out[0].shrunk).toBe(true);
        expect(out[0].warning).toBe("pages became images");
        expect(alt.doConvert).toHaveBeenCalled();
    });

    it("initialises the fallback, which the group-level init never touched", async () => {
        const alt = handler("PdfCanvasCompress", { mainThread: true });
        (alt as any).ready = false;
        vi.mocked(alt.doConvert).mockResolvedValue(
            [{ name: "a.pdf", bytes: new Uint8Array(300) }] as any);
        resolveMock.mockReturnValue({
            handler: handler("Ghostscript"),
            args: [],
            fallback: { handler: alt, args: [], warning: "w" },
        } as any);

        await compressBatch([input("a.pdf", 1000, png)], {
            options: [], level: "medium",
            run: vi.fn(async () => { throw new Error("offline"); }),
        });

        expect(alt.init).toHaveBeenCalled();
    });

    it("never reaches for the fallback when the primary succeeds", async () => {
        const alt = handler("PdfCanvasCompress", { mainThread: true });
        resolveMock.mockReturnValue({
            handler: handler("Ghostscript"),
            args: [],
            fallback: { handler: alt, args: [], warning: "w" },
        } as any);

        const out = await compressBatch(
            [input("a.pdf", 1000, png)],
            { options: [], level: "medium", run: shrinkingRun(0.4) },
        );

        expect(out[0].shrunk).toBe(true);
        expect(out[0].warning).toBeUndefined();
        expect(alt.doConvert).not.toHaveBeenCalled();
    });

    it("does not warn about a fallback whose output was not worth keeping", async () => {
        // Rasterising a text PDF usually makes it bigger. The keep-threshold
        // discards that, and a discarded result must not carry a warning about
        // damage the user never received.
        const alt = handler("PdfCanvasCompress", { mainThread: true });
        vi.mocked(alt.doConvert).mockResolvedValue(
            [{ name: "a.pdf", bytes: new Uint8Array(4000) }] as any);
        resolveMock.mockReturnValue({
            handler: handler("Ghostscript"),
            args: [],
            fallback: { handler: alt, args: [], warning: "pages became images" },
        } as any);

        const out = await compressBatch([input("a.pdf", 1000, png)], {
            options: [], level: "medium",
            run: vi.fn(async () => { throw new Error("offline"); }),
        });

        expect(out[0].shrunk).toBe(false);
        expect(out[0].reason).toBe("no-gain");
        expect(out[0].warning).toBeUndefined();
    });

    it("reports failure when both routes are gone", async () => {
        const alt = handler("PdfCanvasCompress", { mainThread: true });
        vi.mocked(alt.doConvert).mockRejectedValue(new Error("no canvas"));
        resolveMock.mockReturnValue({
            handler: handler("Ghostscript"),
            args: [],
            fallback: { handler: alt, args: [], warning: "w" },
        } as any);

        const out = await compressBatch([input("a.pdf", 1000, png)], {
            options: [], level: "medium",
            run: vi.fn(async () => { throw new Error("offline"); }),
        });

        expect(out[0].reason).toBe("failed");
        expect(out[0].warning).toBeUndefined();
    });
});

describe("compressBatch - degenerate inputs", () => {
    it("calls a file too small to compress already-minimal, not failed", async () => {
        // A 78-byte PNG is signature + IHDR + IEND. ImageMagick errors on it,
        // which used to surface as "failed" - technically what happened, but a
        // lie about the file: nothing was wrong with it and nothing could be won.
        const run = vi.fn(async () => { throw new Error("no pixels"); });
        resolveMock.mockReturnValue({ handler: handler("ImageMagick"), args: [] });

        const out = await compressBatch(
            [input("dot.png", 78, fmt("image/png", "png"))],
            { options: [], level: "medium", run },
        );

        expect(out[0].reason).toBe("already-minimal");
        expect(out[0].shrunk).toBe(false);
        // And we never spent an engine round-trip discovering it.
        expect(run).not.toHaveBeenCalled();
    });

    it("still compresses a file just above the floor", async () => {
        resolveMock.mockReturnValue({ handler: handler("ImageMagick"), args: [] });
        const out = await compressBatch(
            [input("small.png", 600, fmt("image/png", "png"))],
            { options: [], level: "medium", run: shrinkingRun(0.5) },
        );
        expect(out[0].shrunk).toBe(true);
    });
});

describe("compressBatch - hard cancel mid-file", () => {
    /**
     * Compress used to stop only *between* files, so pressing Stop on a batch
     * whose current item was a large video meant waiting minutes for it. Stop
     * now terminates the worker, which surfaces here as a rejected attempt
     * while `isCancelled()` is true.
     */
    it("reports a file abandoned mid-run as stopped, not failed", async () => {
        resolveMock.mockReturnValue({ handler: handler("FFmpeg"), args: [] });
        let cancelled = false;
        const run = vi.fn(async () => { cancelled = true; throw new Error("Cancelled"); });

        const out = await compressBatch(
            [input("big.mp4", 900_000_000, fmt("video/mp4", "mp4"))],
            { options: [], level: "low", run, isCancelled: () => cancelled },
        );

        expect(out[0].reason).toBe("cancelled");
        expect(out[0].shrunk).toBe(false);
        // The user still has their file.
        expect(out[0].bytes.byteLength).toBe(900_000_000);
    });

    it("keeps what already finished and marks only the rest stopped", async () => {
        resolveMock.mockReturnValue({ handler: handler("ImageMagick"), args: [] });
        let seen = 0;
        let cancelled = false;
        const run = vi.fn(async (_n: string, files: any[]) => {
            if (++seen > 1) { cancelled = true; throw new Error("Cancelled"); }
            return [{ name: files[0].name, bytes: new Uint8Array(100) }];
        });

        const out = await compressBatch(
            [
                input("a.png", 1000, fmt("image/png", "png")),
                input("b.png", 1000, fmt("image/png", "png")),
                input("c.png", 1000, fmt("image/png", "png")),
            ],
            { options: [], level: "low", run, isCancelled: () => cancelled },
        );

        expect(out[0].shrunk).toBe(true);
        expect(out[1].reason).toBe("cancelled");
        expect(out[2].reason).toBe("cancelled");
        // Never reached is still the user's decision, not our failure.
        expect(out.some(o => o.reason === "failed")).toBe(false);
    });

    it("does not try the degraded fallback for a file the user cancelled", async () => {
        // The fallback exists for "the engine is unreachable", not "the user
        // asked us to stop" - running it would ignore the Stop and cost time.
        const fallbackRun = vi.fn();
        resolveMock.mockReturnValue({
            handler: handler("Ghostscript"), args: [],
            fallback: { handler: handler("PdfCanvasCompress"), args: [], warning: "degraded" },
        });
        let cancelled = false;
        const run = vi.fn(async () => { cancelled = true; throw new Error("Cancelled"); });

        const out = await compressBatch(
            [input("scan.pdf", 5_000_000, fmt("application/pdf", "pdf"))],
            { options: [], level: "low", run, isCancelled: () => cancelled },
        );

        expect(fallbackRun).not.toHaveBeenCalled();
        expect(out[0].reason).toBe("cancelled");
        expect(out[0].warning).toBeUndefined();
    });
});

describe("compressBatch - lazy input reads", () => {
    /**
     * The batch used to be loaded into memory in full before the first engine
     * ran, so peak usage was every input at once plus every output. That is
     * what the surface's 500 MB cap was really protecting, and it capped the
     * wrong thing: someone compressing one large video was refused in order to
     * guard against a batch of them.
     */
    it("never opens a file it cannot compress", async () => {
        resolveMock.mockReturnValue(null);
        const svg = input("a.svg", 5_000_000, fmt("image/svg+xml", "svg"));
        const out = await compressBatch([svg], { options: [], level: "medium", run: shrinkingRun(0.5) });
        expect(svg.read).not.toHaveBeenCalled();
        expect(out[0].reason).toBe("unsupported");
        // Reported at its real size even though nothing was read.
        expect(out[0].originalSize).toBe(5_000_000);
    });

    it("never opens a file too small to be worth compressing", async () => {
        resolveMock.mockReturnValue({ handler: handler("ImageMagick"), args: [] });
        const tiny = input("t.png", 100, fmt("image/png", "png"));
        const out = await compressBatch([tiny], { options: [], level: "medium", run: shrinkingRun(0.5) });
        expect(tiny.read).not.toHaveBeenCalled();
        expect(out[0].reason).toBe("already-minimal");
    });

    it("reads each file at most once", async () => {
        resolveMock.mockReturnValue({ handler: handler("ImageMagick"), args: [] });
        const a = input("a.png", 10_000, fmt("image/png", "png"));
        await compressBatch([a], { options: [], level: "medium", run: shrinkingRun(0.5) });
        expect(a.read).toHaveBeenCalledTimes(1);
    });

    it("does not read the whole batch before starting work", async () => {
        // The guarantee that makes large batches possible: by the time the
        // first file reaches the engine, the later ones are still on disk.
        resolveMock.mockReturnValue({ handler: handler("ImageMagick"), args: [] });
        const a = input("a.png", 10_000, fmt("image/png", "png"));
        const b = input("b.png", 10_000, fmt("image/png", "png"));
        const c = input("c.png", 10_000, fmt("image/png", "png"));

        let readsAtFirstRun = -1;
        const run = vi.fn(async (_n: string, files: any[]) => {
            if (readsAtFirstRun < 0) {
                readsAtFirstRun = [a, b, c].filter(i => i.read.mock.calls.length > 0).length;
            }
            return [{ name: files[0].name, bytes: new Uint8Array(100) }];
        });

        await compressBatch([a, b, c], { options: [], level: "medium", run });
        expect(readsAtFirstRun).toBe(1);
    });

    it("reports a file that vanished between picking and compressing as failed", async () => {
        resolveMock.mockReturnValue({ handler: handler("ImageMagick"), args: [] });
        const gone = input("gone.png", 10_000, fmt("image/png", "png"));
        gone.read.mockRejectedValueOnce(new Error("NotFoundError") as never);
        const run = shrinkingRun(0.5);

        const out = await compressBatch([gone], { options: [], level: "medium", run });
        expect(out[0].reason).toBe("failed");
        expect(out[0].originalSize).toBe(10_000);
        // One unreadable file must not take the batch down with it.
        expect(run).not.toHaveBeenCalled();
    });

    it("keeps going after one file fails to read", async () => {
        resolveMock.mockReturnValue({ handler: handler("ImageMagick"), args: [] });
        const gone = input("gone.png", 10_000, fmt("image/png", "png"));
        gone.read.mockRejectedValueOnce(new Error("NotFoundError") as never);
        const ok = input("ok.png", 10_000, fmt("image/png", "png"));

        const out = await compressBatch([gone, ok], {
            options: [], level: "medium", run: shrinkingRun(0.5),
        });
        expect(out[0].reason).toBe("failed");
        expect(out[1].shrunk).toBe(true);
    });
});

/**
 * The reported bug: compressing a 190 MB video showed one unchanging sentence
 * for minutes. `RunHandler` had declared an `onProgress` parameter since it was
 * written and the two call sites simply never passed it, so every engine that
 * reports its own progress was silenced on this surface.
 */
describe("progress reaches the surface", () => {
    /** A runner that reports progress the way a real engine does. */
    const reportingRun = (events: { ratio?: number; detail?: string }[]) =>
        vi.fn(async (_n: string, files: any[], _i: any, _o: any, _a: any, onProgress?: any) => {
            for (const e of events) onProgress?.(e);
            return [{ name: files[0].name, bytes: new Uint8Array(Math.floor(files[0].bytes.byteLength * 0.5)) }];
        });

    it("forwards engine progress from a worker handler", async () => {
        resolveMock.mockReturnValue({ handler: handler("FFmpeg"), args: [] });
        const seen: any[] = [];
        await compressBatch([input("clip.mp4", 10_000, fmt("video/mp4", "mp4"))], {
            options: [], level: "medium",
            run: reportingRun([{ ratio: 0.3, detail: "Encoded 3s of 10s" }, { ratio: 0.9 }]),
            onEngineProgress: p => seen.push(p),
        });
        expect(seen).toEqual([{ ratio: 0.3, detail: "Encoded 3s of 10s" }, { ratio: 0.9 }]);
    });

    it("forwards engine progress from a main-thread handler too", async () => {
        // pdfCanvasCompress runs on the main thread and reports per-page ratios;
        // it bypasses `run` entirely, so it needs its own pass-through.
        const h = handler("pdfCanvasCompress", { mainThread: true });
        (h.doConvert as any).mockImplementation(
            async (files: any[], _i: any, _o: any, _a: any, onProgress?: any) => {
                onProgress?.({ ratio: 0.5, detail: "Rasterising page 1 of 2" });
                return [{ name: files[0].name, bytes: new Uint8Array(100) }];
            });
        resolveMock.mockReturnValue({ handler: h, args: [] });

        const seen: any[] = [];
        await compressBatch([input("scan.pdf", 10_000, fmt("application/pdf", "pdf"))], {
            options: [], level: "medium", run: vi.fn(),
            onEngineProgress: p => seen.push(p),
        });
        expect(seen).toEqual([{ ratio: 0.5, detail: "Rasterising page 1 of 2" }]);
    });

    it("announces an engine load before the wait, with the format that needs it", async () => {
        const h = handler("FFmpeg");
        (h as any).ready = false;
        (h.init as any).mockImplementation(async () => { (h as any).ready = true; });
        resolveMock.mockReturnValue({ handler: h, args: [] });

        const inits: [string, string][] = [];
        await compressBatch([input("clip.mp4", 10_000, fmt("video/mp4", "mp4"))], {
            options: [], level: "medium", run: shrinkingRun(0.5),
            onEngineInit: (name, format) => inits.push([name, format.format]),
        });
        expect(inits).toEqual([["FFmpeg", "mp4"]]);
    });

    it("says nothing about loading an engine that was already loaded", async () => {
        resolveMock.mockReturnValue({ handler: handler("FFmpeg"), args: [] });
        const onEngineInit = vi.fn();
        await compressBatch([input("clip.mp4", 10_000, fmt("video/mp4", "mp4"))], {
            options: [], level: "medium", run: shrinkingRun(0.5), onEngineInit,
        });
        expect(onEngineInit).not.toHaveBeenCalled();
    });

    it("reports reading and compressing as separate phases, in that order", async () => {
        // The modal used to say "Reading your file..." across the engine load
        // and then "Compressing..." across the actual read. Both labels were on
        // the wrong phase.
        resolveMock.mockReturnValue({ handler: handler("ImageMagick"), args: [] });
        const order: string[] = [];
        await compressBatch([input("photo.png", 10_000, fmt("image/png", "png"))], {
            options: [], level: "medium", run: shrinkingRun(0.5),
            onFileRead: n => order.push(`read:${n}`),
            onFileCompress: n => order.push(`compress:${n}`),
        });
        expect(order).toEqual(["read:photo.png", "compress:photo.png"]);
    });

    it("still leaves the reading phase for an engine that reports nothing", async () => {
        // ImageMagick emits no progress at all. Without `onFileCompress` the
        // modal would sit on "Reading your file..." for the whole compression.
        resolveMock.mockReturnValue({ handler: handler("ImageMagick"), args: [] });
        const onFileCompress = vi.fn();
        await compressBatch([input("photo.png", 10_000, fmt("image/png", "png"))], {
            options: [], level: "medium", run: shrinkingRun(0.5), onFileCompress,
        });
        expect(onFileCompress).toHaveBeenCalledWith("photo.png");
    });

    it("never announces a read for a file it decided about from metadata", async () => {
        // A file too small to gain anything is never opened; claiming to read it
        // would be a phase the user waits through that does not exist.
        resolveMock.mockReturnValue({ handler: handler("ImageMagick"), args: [] });
        const onFileRead = vi.fn();
        const out = await compressBatch([input("tiny.png", 100, fmt("image/png", "png"))], {
            options: [], level: "medium", run: vi.fn(), onFileRead,
        });
        expect(out[0].reason).toBe("already-minimal");
        expect(onFileRead).not.toHaveBeenCalled();
    });
});
