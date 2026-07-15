import { describe, it, expect } from "vitest";
import { timestampForFilename } from "./download.ts";

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
