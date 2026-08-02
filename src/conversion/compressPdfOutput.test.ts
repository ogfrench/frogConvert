import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * This step runs *after* work the user already asked for and that already
 * succeeded. So the properties that matter are mostly about what it must never
 * do: never throw away a finished merge, never hand back something bigger, and
 * never run at all when the user asked for their document untouched.
 */

vi.mock("./workerClient.ts", () => ({ runInWorker: vi.fn(), cancelActiveWorkerJob: vi.fn(() => true) }));
vi.mock("../core/compression/automatic.ts", () => ({ decideAutoQuality: vi.fn() }));

const {
    compressPdfOutput,
    compressPdfOutputs,
    cancelPdfOutputCompression,
    resetPdfOutputCompression,
    wasPdfOutputCompressionCancelled,
} = await import("./compressPdfOutput.ts");
import { runInWorker } from "./workerClient.ts";
import { decideAutoQuality } from "../core/compression/automatic.ts";

const runMock = vi.mocked(runInWorker);
const autoMock = vi.mocked(decideAutoQuality);
const bytes = (n: number) => new Uint8Array(n);

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("compressPdfOutput", () => {
    it("does not touch the engine at Original quality", async () => {
        // The default. Editing a PDF should hand back the document you built.
        const input = bytes(1000);
        expect(await compressPdfOutput(input, "lossless")).toBe(input);
        expect(runMock).not.toHaveBeenCalled();
    });

    it("routes through Ghostscript at every other level", async () => {
        runMock.mockResolvedValue([{ name: "d.pdf", bytes: bytes(400) }]);
        const out = await compressPdfOutput(bytes(1000), "medium");
        expect(out.byteLength).toBe(400);
        // Positional rather than a whole-call match: the assertion is about
        // which quality reached the engine, not how many parameters the call
        // happens to take.
        expect(runMock.mock.calls[0][0]).toBe("Ghostscript");
        expect(runMock.mock.calls[0][4]).toEqual(["--quality", "medium"]);
    });

    it("resolves Automatic to a real preset before the engine sees it", async () => {
        // "--quality auto" is not something Ghostscript understands, so the
        // level has to be decided here or the pass fails on the argv.
        autoMock.mockResolvedValue({ kind: "compress", tier: "high" });
        runMock.mockResolvedValue([{ name: "d.pdf", bytes: bytes(400) }]);

        await compressPdfOutput(bytes(1000), "auto");

        // Positional rather than a whole-call match: the assertion is about
        // which quality reached the engine, not how many parameters the call
        // happens to take.
        expect(runMock.mock.calls[0][0]).toBe("Ghostscript");
        expect(runMock.mock.calls[0][4]).toEqual(["--quality", "high"]);
    });

    it("skips the engine entirely when Automatic finds nothing left to give", async () => {
        // An engine pass on an already-minimal PDF can only make it bigger,
        // and the keep-threshold would discard the result anyway.
        autoMock.mockResolvedValue({ kind: "already-minimal" });
        const input = bytes(1000);

        expect(await compressPdfOutput(input, "auto")).toBe(input);
        expect(runMock).not.toHaveBeenCalled();
    });

    it("still compresses when the Automatic probe cannot read the document", async () => {
        // The probe is an optimisation, not a gate. Abandoning a compression
        // the user asked for because we could not inspect the file would be
        // the wrong way to fail.
        autoMock.mockRejectedValue(new Error("unreadable"));
        runMock.mockResolvedValue([{ name: "d.pdf", bytes: bytes(400) }]);

        await compressPdfOutput(bytes(1000), "auto");

        // Positional rather than a whole-call match: the assertion is about
        // which quality reached the engine, not how many parameters the call
        // happens to take.
        expect(runMock.mock.calls[0][0]).toBe("Ghostscript");
        expect(runMock.mock.calls[0][4]).toEqual(["--quality", "high"]);
    });

    it("does not probe at all for an explicitly chosen level", async () => {
        // The probe reads container metadata, not pixels, so letting it speak
        // over an instruction is how the Compress surface once reported
        // "already compressed" at every setting.
        runMock.mockResolvedValue([{ name: "d.pdf", bytes: bytes(400) }]);
        await compressPdfOutput(bytes(1000), "low");
        expect(autoMock).not.toHaveBeenCalled();
    });

    it("keeps the original when the squeeze saves too little to be worth it", async () => {
        // Same 98% rule compressBatch uses: a file that came back the same size
        // has traded image quality for nothing.
        const input = bytes(1000);
        runMock.mockResolvedValue([{ name: "d.pdf", bytes: bytes(990) }]);
        expect(await compressPdfOutput(input, "low")).toBe(input);
    });

    it("keeps the original when the engine makes it bigger", async () => {
        const input = bytes(1000);
        runMock.mockResolvedValue([{ name: "d.pdf", bytes: bytes(2000) }]);
        expect(await compressPdfOutput(input, "low")).toBe(input);
    });

    it("returns the original rather than throwing when the engine fails", async () => {
        // The merge already succeeded. Losing it to an optional extra step the
        // user never asked about would be a far worse outcome than a big file.
        const input = bytes(1000);
        runMock.mockRejectedValue(new Error("couldn't fetch the engine"));
        await expect(compressPdfOutput(input, "medium")).resolves.toBe(input);
    });

    it("returns the original when the engine produces nothing", async () => {
        const input = bytes(1000);
        runMock.mockResolvedValue([]);
        await expect(compressPdfOutput(input, "medium")).resolves.toBe(input);
    });
});

describe("compressPdfOutputs", () => {
    it("passes a batch straight through at Original quality", async () => {
        const list = [{ name: "a.pdf", bytes: bytes(10) }, { name: "b.pdf", bytes: bytes(20) }];
        const out = await compressPdfOutputs(list, "lossless");
        expect(out.map(r => r.name)).toEqual(["a.pdf", "b.pdf"]);
        expect(runMock).not.toHaveBeenCalled();
    });

    it("compresses every file and keeps names and order", async () => {
        runMock.mockImplementation(async (_h, files: any) =>
            [{ name: files[0].name, bytes: bytes(100) }]);
        const out = await compressPdfOutputs(
            [{ name: "a.pdf", bytes: bytes(1000) }, { name: "b.pdf", bytes: bytes(1000) }], "low");
        expect(out.map(r => r.name)).toEqual(["a.pdf", "b.pdf"]);
        expect(out.every(r => r.bytes.byteLength === 100)).toBe(true);
    });

    it("lets a single failure through without losing the rest of the batch", async () => {
        runMock
            .mockRejectedValueOnce(new Error("boom"))
            .mockResolvedValueOnce([{ name: "b.pdf", bytes: bytes(100) }]);
        const out = await compressPdfOutputs(
            [{ name: "a.pdf", bytes: bytes(1000) }, { name: "b.pdf", bytes: bytes(1000) }], "low");
        expect(out[0].bytes.byteLength).toBe(1000);  // untouched original
        expect(out[1].bytes.byteLength).toBe(100);
    });
});

describe("skipping the compression step", () => {
    /**
     * The edit is already finished when this step starts, so a cancel here can
     * never lose work: it hands back the completed document uncompressed, which
     * is exactly what Original quality produces. Before this, the step had no
     * exit but the 10-minute worker timeout.
     */
    beforeEach(() => resetPdfOutputCompression());

    it("returns the finished document untouched when skipped", async () => {
        resetPdfOutputCompression();
        cancelPdfOutputCompression();
        const original = bytes(5_000_000);
        const out = await compressPdfOutput(original, "medium", "merged.pdf");
        expect(out).toBe(original);
        expect(runMock).not.toHaveBeenCalled();
    });

    it("terminates the engine run that is already in flight", async () => {
        resetPdfOutputCompression();
        cancelPdfOutputCompression();
        const { cancelActiveWorkerJob } = await import("./workerClient.ts");
        expect(vi.mocked(cancelActiveWorkerJob)).toHaveBeenCalled();
    });

    it("skips the remaining documents in a multi-file save, not just the current one", async () => {
        resetPdfOutputCompression();
        // First file compresses, then the user skips; the rest come back as-is
        // rather than making them press cancel once per document.
        runMock.mockImplementationOnce(async () => {
            cancelPdfOutputCompression();
            return [{ name: "a.pdf", bytes: bytes(100) }] as never;
        });

        const out = await compressPdfOutputs([
            { name: "a.pdf", bytes: bytes(1000) },
            { name: "b.pdf", bytes: bytes(1000) },
            { name: "c.pdf", bytes: bytes(1000) },
        ], "medium");

        expect(runMock).toHaveBeenCalledTimes(1);
        expect(out[1].bytes.byteLength).toBe(1000);
        expect(out[2].bytes.byteLength).toBe(1000);
        expect(out.map(o => o.name)).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    });

    it("a skip does not leak into the next save", async () => {
        resetPdfOutputCompression();
        cancelPdfOutputCompression();
        expect(wasPdfOutputCompressionCancelled()).toBe(true);

        resetPdfOutputCompression();
        expect(wasPdfOutputCompressionCancelled()).toBe(false);
        runMock.mockResolvedValueOnce([{ name: "x.pdf", bytes: bytes(100) }] as never);
        const out = await compressPdfOutput(bytes(1000), "medium", "x.pdf");
        expect(out.byteLength).toBe(100);
    });
});

/**
 * Ghostscript reports a ratio, and on first use a real download percentage for
 * its own ~16 MB engine. The PDF editor used to discard all of it and sit
 * behind a static spinner.
 */
describe("progress forwarding", () => {
    it("hands the engine a progress callback", async () => {
        runMock.mockResolvedValueOnce([{ name: "x.pdf", bytes: bytes(100) }] as never);
        const onProgress = vi.fn();
        await compressPdfOutput(bytes(1000), "medium", "x.pdf", onProgress);
        // 6th argument of runInWorker is the progress sink.
        expect(runMock.mock.calls[0][5]).toBe(onProgress);
    });

    it("works exactly as before when nobody is listening", async () => {
        runMock.mockResolvedValueOnce([{ name: "x.pdf", bytes: bytes(100) }] as never);
        const out = await compressPdfOutput(bytes(1000), "medium", "x.pdf");
        expect(out.byteLength).toBe(100);
        expect(runMock.mock.calls[0][5]).toBeUndefined();
    });

    it("tags each batch event with its position, so the popup can say which PDF", async () => {
        runMock.mockResolvedValue([{ name: "a.pdf", bytes: bytes(10) }] as never);
        const seen: [number, number][] = [];
        await compressPdfOutputs(
            [{ name: "a.pdf", bytes: bytes(1000) }, { name: "b.pdf", bytes: bytes(1000) }],
            "medium",
            (_p, index, total) => seen.push([index, total]),
        );
        // Drive the sinks the worker would have driven.
        const sinks = runMock.mock.calls.map(c => c[5] as ((p: unknown) => void) | undefined);
        sinks.forEach(s => s?.({ ratio: 0.5 }));
        expect(seen).toEqual([[0, 2], [1, 2]]);
    });

    it("never reaches the engine at Original quality, so never reports progress", async () => {
        const onProgress = vi.fn();
        await compressPdfOutputs([{ name: "a.pdf", bytes: bytes(1000) }], "lossless", onProgress);
        expect(runMock).not.toHaveBeenCalled();
        expect(onProgress).not.toHaveBeenCalled();
    });
});
