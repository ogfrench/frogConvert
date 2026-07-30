import { describe, it, expect } from "vitest";
import { planVideo, planGif, planImage, planAudio, type ImageArchetype } from "./plan.ts";

const MB = 1_000_000;

describe("planVideo", () => {
    it("bypasses tier logic for lossless (crf 0, full quality)", () => {
        expect(planVideo(9999 * MB, "lossless")).toEqual({ videoCrf: 0, imgQuality: 100 });
    });

    it("clamps huge inputs to 1080p with a lower maxrate", () => {
        const p = planVideo(1200 * MB, "medium");
        expect(p.videoCrf).toBe(25);
        expect(p.videoScaleFilter).toContain("1080");
        expect(p.videoMaxrate).toBe("6M");
    });

    it("clamps mid-size inputs to 1440p", () => {
        const p = planVideo(200 * MB, "medium");
        expect(p.videoCrf).toBe(23);
        expect(p.videoScaleFilter).toContain("1440");
    });

    it("leaves small inputs unscaled", () => {
        const p = planVideo(50 * MB, "medium");
        expect(p.videoCrf).toBe(23);
        expect(p.videoScaleFilter).toBeUndefined();
    });

    it("scales tier thresholds by preset (low fires more aggressively)", () => {
        // 600 MB is under medium's 1000 MB cap, but over low's 500 MB (1000/2) cap.
        expect(planVideo(600 * MB, "medium").videoScaleFilter).toContain("1440");
        expect(planVideo(600 * MB, "low").videoScaleFilter).toContain("1080");
    });

    // The size tiers only fire above 75 MB, so for an ordinary clip they are
    // never reached and CRF is the *only* thing the level can change. When it
    // didn't, all three levels produced the same bytes and the control was
    // decoration.
    it("varies quality by preset for a small video, where no tier fires", () => {
        const low = planVideo(17 * MB, "low");
        const medium = planVideo(17 * MB, "medium");
        const high = planVideo(17 * MB, "high");

        expect(low.videoScaleFilter).toBeUndefined();
        expect(medium.videoScaleFilter).toBeUndefined();
        expect(high.videoScaleFilter).toBeUndefined();

        expect(low.videoCrf).toBeGreaterThan(medium.videoCrf!);
        expect(high.videoCrf).toBeLessThan(medium.videoCrf!);
        expect(new Set([low.videoCrf, medium.videoCrf, high.videoCrf]).size).toBe(3);
    });

    it("keeps medium's output exactly where it was", () => {
        expect(planVideo(17 * MB, "medium").videoCrf).toBe(23);
        expect(planVideo(200 * MB, "medium").videoCrf).toBe(23);
        expect(planVideo(1200 * MB, "medium").videoCrf).toBe(25);
    });
});

describe("planGif", () => {
    it("passes lossless straight through", () => {
        expect(planGif(999 * MB, "lossless")).toEqual({ imgQuality: 100 });
    });

    it("downscales + drops fps hardest for the largest gifs", () => {
        const p = planGif(40 * MB, "medium");
        expect(p.gifScaleFilter).toContain("480");
        expect(p.gifFps).toBe(15);
    });

    it("leaves small gifs at their native size", () => {
        const p = planGif(1 * MB, "medium");
        expect(p.gifScaleFilter).toBeUndefined();
        expect(p.imgQuality).toBe(82);
    });
});

describe("planImage", () => {
    const ctx = (over: Partial<Parameters<typeof planImage>[0]> = {}) => planImage({
        pixelCount: 1_000_000,
        preset: "medium",
        outputLossless: false,
        archetype: "singleton",
        ...over,
    });

    it("returns full quality and no resize for lossless preset", () => {
        expect(ctx({ preset: "lossless" })).toEqual({ imgQuality: 100, imgMaxEdge: null });
    });

    it("returns full quality when the output format is lossless", () => {
        expect(ctx({ outputLossless: true }).imgQuality).toBe(100);
    });

    it("keeps a hand-picked singleton above a video frame", () => {
        // Archetype is an offset now, not the base: the preset decides the
        // ballpark and the archetype nudges it.
        expect(ctx({ archetype: "singleton" }).imgQuality).toBe(80);
        expect(ctx({ archetype: "video-frame" }).imgQuality).toBe(68);
    });

    it("spans a band wide enough for the level names to mean something", () => {
        // Was 82 / 90 / 93 — eleven points, all of it inside what other tools
        // call high quality, so "Smallest file" saved almost nothing. Squoosh
        // ships at 75 by default; aggressive presets elsewhere sit near 65.
        expect(ctx({ preset: "low" }).imgQuality).toBe(65);
        expect(ctx({ preset: "medium" }).imgQuality).toBe(80);
        expect(ctx({ preset: "high" }).imgQuality).toBe(93);
    });

    it("resizes an ordinary photo, which is where the saving actually is", () => {
        // The old plan only resized above 30 megapixels, which no phone photo
        // reaches, so quality alone had to carry the whole ladder and could not.
        // Halving the long edge quarters the pixels.
        expect(ctx({ preset: "low" }).imgMaxEdge).toBe(1920);
        expect(ctx({ preset: "medium" }).imgMaxEdge).toBe(2560);
        // "High quality" means keep what you have.
        expect(ctx({ preset: "high" }).imgMaxEdge).toBeNull();
    });

    it("caps a video frame's longest edge at 1080p on the web default", () => {
        expect(ctx({ archetype: "video-frame" }).imgMaxEdge).toBe(1920);
    });

    it("keeps 4K detail for a video frame under the high preset", () => {
        expect(ctx({ archetype: "video-frame", preset: "high" }).imgMaxEdge).toBe(3840);
    });

    it("clamps a colossal source harder than the preset alone would", () => {
        const p = ctx({ pixelCount: 200 * MB, archetype: "singleton", preset: "high" });
        expect(p.imgMaxEdge).toBe(2800);
        expect(p.imgQuality).toBe(91); // 93 - 2
    });

    it("takes the tighter of the preset cap and the archetype cap", () => {
        // A video frame carries its own 1920 ceiling; `medium` would allow 2560.
        expect(ctx({ archetype: "video-frame", preset: "medium" }).imgMaxEdge).toBe(1920);
        // Under `high` the frame's own 3840 applies, since the preset has no cap.
        expect(ctx({ archetype: "video-frame", preset: "high" }).imgMaxEdge).toBe(3840);
    });

    it("never drops below a floor, however the offsets stack", () => {
        expect(ctx({ preset: "low", archetype: "video-frame" }).imgQuality).toBeGreaterThanOrEqual(45);
    });
});

describe("planAudio", () => {
    it("skips the bitrate table entirely for lossless output", () => {
        expect(planAudio(true, 2, "medium")).toEqual({ audioKbps: null, imgQuality: 100 });
        expect(planAudio(false, 2, "lossless")).toEqual({ audioKbps: null, imgQuality: 100 });
    });

    it("gives stereo more headroom than mono", () => {
        expect(planAudio(false, 2, "medium").audioKbps).toBe(192);
        expect(planAudio(false, 1, "medium").audioKbps).toBe(128);
    });

    it("scales bitrate by preset", () => {
        expect(planAudio(false, 2, "low").audioKbps).toBe(128);
        expect(planAudio(false, 2, "high").audioKbps).toBe(256);
    });
});
