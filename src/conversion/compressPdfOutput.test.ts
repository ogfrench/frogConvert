import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * This step runs *after* work the user already asked for and that already
 * succeeded. So the properties that matter are mostly about what it must never
 * do: never throw away a finished merge, never hand back something bigger, and
 * never run at all when the user asked for their document untouched.
 */

vi.mock("./workerClient.ts", () => ({ runInWorker: vi.fn() }));

const { compressPdfOutput, compressPdfOutputs } = await import("./compressPdfOutput.ts");
import { runInWorker } from "./workerClient.ts";

const runMock = vi.mocked(runInWorker);
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
        expect(runMock).toHaveBeenCalledWith(
            "Ghostscript", expect.anything(), expect.anything(), expect.anything(),
            ["--quality", "medium"]);
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
