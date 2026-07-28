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

function input(name: string, size: number, format: FileFormat) {
    return { name, bytes: new Uint8Array(size), format };
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

describe("compressBatch — grouping", () => {
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
        // Three files, three runs — but grouped so each engine is touched once per group.
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

describe("compressBatch — per-file outcomes", () => {
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

    it("skips files already at minimum useful quality", async () => {
        resolveMock.mockReturnValue({ handler: handler("ImageMagick"), args: [] });
        tierDownMock.mockReturnValue({ kind: "skip" } as any);
        const run = shrinkingRun(0.5);
        const out = await compressBatch(
            [input("tiny.jpg", 900, fmt("image/jpeg", "jpeg"))],
            { options: [], level: "medium", run },
        );
        expect(out[0].reason).toBe("already-minimal");
        expect(run).not.toHaveBeenCalled();
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

describe("compressBatch — level handling", () => {
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

describe("compressBatch — main-thread handlers", () => {
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

describe("compressBatch — cancellation", () => {
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
});

describe("totalSaved", () => {
    it("sums only the files that actually shrank", () => {
        expect(totalSaved([
            { name: "a", bytes: new Uint8Array(400), originalSize: 1000, shrunk: true },
            { name: "b", bytes: new Uint8Array(500), originalSize: 500, shrunk: false, reason: "no-gain" },
        ])).toBe(600);
    });
});
