// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Source-level guards for two FFmpeg behaviours that unit tests cannot reach.
 *
 * ffmpeg.wasm has no Node build - `@ffmpeg/ffmpeg` resolves to a stub that
 * throws "ffmpeg.wasm does not support nodejs" - so the only engine in the app
 * that reports a real percentage cannot be exercised in CI at all. Both of the
 * bugs below were found by driving a browser by hand, and both would come back
 * silently: the code would still compile, every unit test would still pass, and
 * the failure would only show up as a number that never moves or a conversion
 * that always dies.
 *
 * Reading the source is a blunt instrument and deliberately so. These assert
 * that a specific decision is still being made, and point at why.
 *
 * The same technique guards the Electron routes; see test/electron-routes.test.ts.
 */
const SRC = fs.readFileSync(
    path.resolve(__dirname, "./FFmpeg.ts"), "utf8");

describe("FFmpeg source invariants", () => {
    it("still seeds progress duration from the probe", () => {
        // Input goes through the concat demuxer, which reports `Duration: N/A`.
        // That silences BOTH progress sources - the log tap has nothing to
        // divide by, and ffmpeg's own event is computed against the same
        // missing number, so it emits a flat 0 forever. Compressing a
        // 20-second video sat at "0%" for four and a half minutes.
        expect(SRC).toMatch(/-f",\s*"concat"/);
        expect(SRC).toMatch(/resolveProgressDurationMs\(command,\s*probedDuration\)/);
    });

    it("still prefers its own duration over ffmpeg's when computing the ratio", () => {
        // `ev.time` stays correct under concat even though `ev.progress` does
        // not, so the ratio is computed from time and the probed duration.
        // Reverting to `emitProgress(ev.progress, ...)` alone reinstates the
        // bug without breaking anything a test would notice.
        const listener = SRC.slice(
            SRC.indexOf("wasmProgressListener = (ev)"),
            SRC.indexOf("this.#ffmpeg.on(\"progress\""));
        expect(listener).toMatch(/timeMs\s*\/\s*durationMs/);
        expect(listener).toMatch(/durationMs\s*&&\s*durationMs\s*>\s*0/);
    });

    it("still pins WebM to the encoders that do not crash", () => {
        // Both of the muxer's preferred encoders die in this WASM core with
        // "memory access out of bounds" on a two-second clip: libvpx-vp9 for
        // video and libopus for audio. VP8 and Vorbis complete cleanly, so
        // every MP4-to-WebM conversion needs both pinned.
        expect(SRC).toMatch(/const WEBM_VIDEO_CODEC = "libvpx"/);
        expect(SRC).toMatch(/const WEBM_AUDIO_CODEC = "libvorbis"/);
        expect(SRC).toMatch(/"-c:v",\s*WEBM_VIDEO_CODEC,\s*"-c:a",\s*WEBM_AUDIO_CODEC/);
        // Neither crashing encoder is chosen anywhere.
        expect(SRC).not.toMatch(/"libvpx-vp9"/);
        expect(SRC).not.toMatch(/"libopus"/);
    });

    it("still pins the VP8 speed that lets a clip finish inside the worker ceiling", () => {
        // libvpx's default (-cpu-used 0) encodes 1080p at ~10x realtime in this
        // core - 205s for a 20-second clip - against a ten-minute worker
        // timeout. `-cpu-used 5` is 4.6x faster on the same source. Dropping
        // this line puts long clips back over the ceiling, which reads to the
        // user as the generic failure #23 was filed about.
        expect(SRC).toMatch(/const WEBM_CPU_USED = "5"/);
        expect(SRC).toMatch(/command\.push\("-cpu-used", WEBM_CPU_USED\)/);
    });

    it("does not rely on -crf for WebM, which this core ignores", () => {
        // Measured on high-entropy 720p, fresh engine per run: -crf 23, -crf 32,
        // and both again with -b:v 0, all produced byte-identical output
        // (136,955 B). `-b:v 2M` produced 709,669 B. So CRF is inert for libvpx
        // here and bitrate is the only lever that moves - which is why the
        // WebM branch pins speed rather than quality, and why the compression
        // level not reaching this route is tracked separately.
        const webmBranch = SRC.slice(
            SRC.indexOf('outputFormat.format === "webm" && !isAudioToVideo'),
            SRC.indexOf('outputFormat.internal === "dvd"'));
        expect(webmBranch).not.toMatch(/"-crf"/);
    });
});
