import { describe, it, expect } from "vitest";
import { resolveProgressDurationMs } from "./FFmpeg.ts";

/**
 * Reported: compressing an 18 MB mp4 at "Smallest file" sat on 0% for four and
 * a half minutes.
 *
 * The engine was never the problem - it emitted 131 progress events during that
 * run. Every one carried `progress: 0`, because input goes through the concat
 * demuxer, concat reports `Duration: N/A`, and both progress paths divide by
 * that missing duration. The fix is to measure against the duration the `-i`
 * probe already established.
 */
describe("resolveProgressDurationMs", () => {
    it("uses the probed duration when the command carries no trim", () => {
        // The reported case: concat gives us nothing, the probe gives us 19.97s.
        expect(resolveProgressDurationMs(
            ["-hide_banner", "-f", "concat", "-safe", "0", "-i", "list.txt", "out.mp4"],
            19.97,
        )).toBeCloseTo(19970);
    });

    it("prefers an explicit -t over the probed source length", () => {
        // Video-to-GIF caps the output. Measuring 8s of encoding against a
        // 300s source would leave the bar stuck under 3% and never finish.
        expect(resolveProgressDurationMs(
            ["-i", "list.txt", "-ss", "0", "-t", "8", "out.gif"], 300,
        )).toBe(8000);
    });

    it("returns null when neither is known, so the caller can fall back", () => {
        expect(resolveProgressDurationMs(["-i", "list.txt", "out.mp4"], 0)).toBeNull();
    });

    it("ignores a -t that is not a usable number", () => {
        // Falls back to the probe rather than poisoning the ratio with NaN,
        // which would render as "NaN%".
        for (const bad of ["abc", "0", "-5", ""]) {
            expect(resolveProgressDurationMs(["-t", bad, "out.mp4"], 12))
                .toBeCloseTo(12000);
        }
    });

    it("ignores a trailing -t with no value", () => {
        expect(resolveProgressDurationMs(["-i", "list.txt", "-t"], 12)).toBeCloseTo(12000);
        expect(resolveProgressDurationMs(["-i", "list.txt", "-t"], 0)).toBeNull();
    });

    it("takes the last -t when the command carries more than one", () => {
        // Recovery retries rebuild the command and can append their own.
        expect(resolveProgressDurationMs(["-t", "30", "-i", "in.mp4", "-t", "5", "out.mp4"], 60))
            .toBe(5000);
    });

    it("is not fooled by an argument that merely starts with -t", () => {
        expect(resolveProgressDurationMs(["-to", "9", "-i", "list.txt"], 42))
            .toBeCloseTo(42000);
    });
});
