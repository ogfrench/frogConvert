import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const toasted = vi.fn();
vi.mock("../components/Toast/Toast.ts", () => ({ showToast: (...a: unknown[]) => toasted(...a) }));

const { timestampForFilename, downloadFile, downloadAsZip } = await import("./download.ts");

describe("timestampForFilename", () => {
    it("formats a date as compact ISO-8601 basic YYYYMMDD-HHMMSS", () => {
        // 2026-07-15 14:32:07 local time
        const d = new Date(2026, 6, 15, 14, 32, 7);
        expect(timestampForFilename(d)).toBe("20260715-143207");
    });

    it("zero-pads every field", () => {
        // 2026-01-05 09:03:04 local time
        const d = new Date(2026, 0, 5, 9, 3, 4);
        expect(timestampForFilename(d)).toBe("20260105-090304");
    });

    it("produces a filesystem-safe token (no colons, slashes, or spaces)", () => {
        expect(timestampForFilename(new Date())).toMatch(/^\d{8}-\d{6}$/);
    });

    it("changes second-to-second so repeated exports don't collide", () => {
        const a = timestampForFilename(new Date(2026, 6, 15, 14, 32, 7));
        const b = timestampForFilename(new Date(2026, 6, 15, 14, 32, 8));
        expect(a).not.toBe(b);
    });
});

/**
 * Reported: exporting a PDF on a phone downloaded the file and then put
 * "frogConvert hit an error" on screen. Every download entry point is reached
 * from a click handler that ignores the returned promise, so anything thrown
 * here - a Blob the device has no memory for, a ZIP that could not be built -
 * escaped as an unhandled rejection into the app-wide recovery popup, which
 * names nothing and offers only a reload.
 */
describe("a download that fails", () => {
    beforeEach(() => { toasted.mockClear(); });
    afterEach(() => { vi.unstubAllGlobals(); });

    /** The realistic failure on a phone: no memory for the Blob's object URL. */
    const breakObjectUrl = () => vi.stubGlobal("URL", {
        ...URL,
        createObjectURL: () => { throw new DOMException("Out of memory", "UnknownError"); },
        revokeObjectURL: () => {},
    });

    it("reports through a toast rather than throwing at the click handler", () => {
        breakObjectUrl();
        let result: boolean | undefined;
        expect(() => { result = downloadFile(new Uint8Array([1, 2, 3]), "out.pdf"); }).not.toThrow();
        expect(result).toBe(false);
        expect(String(toasted.mock.calls[0][0])).toMatch(/couldn't save that file/i);
    });

    it("does the same for a ZIP, which is the multi-file path", async () => {
        breakObjectUrl();
        await expect(downloadAsZip([{ name: "a.pdf", bytes: new Uint8Array([1]) }], "out.zip"))
            .resolves.toBe(false);
        expect(String(toasted.mock.calls[0][0])).toMatch(/couldn't build that zip/i);
    });

    it("says it worked when it did", () => {
        // Fake timers because the success path arms the 5s object-URL revoke,
        // and a timer outliving the file fails the run (see test/setup.ts).
        vi.useFakeTimers();
        try {
            expect(downloadFile(new Uint8Array([1, 2, 3]), "out.pdf")).toBe(true);
            expect(toasted).not.toHaveBeenCalled();
            vi.runAllTimers();
        } finally {
            vi.useRealTimers();
        }
    });
});
