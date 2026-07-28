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

    it("uses a higher base quality for a hand-picked singleton than a video frame", () => {
        expect(ctx({ archetype: "singleton" }).imgQuality).toBe(90);
        expect(ctx({ archetype: "video-frame" }).imgQuality).toBe(78);
    });

    it("nudges quality down for low and up for high", () => {
        expect(ctx({ preset: "low" }).imgQuality).toBe(82);  // 90 - 8
        expect(ctx({ preset: "high" }).imgQuality).toBe(93); // 90 + 3
    });

    it("caps a video frame's longest edge at 1080p on the web default", () => {
        expect(ctx({ archetype: "video-frame" }).imgMaxEdge).toBe(1920);
    });

    it("keeps 4K detail for a video frame under the high preset", () => {
        expect(ctx({ archetype: "video-frame", preset: "high" }).imgMaxEdge).toBe(3840);
    });

    it("hard-clamps very large images to 2800px", () => {
        const p = ctx({ pixelCount: 200 * MB, archetype: "singleton" });
        expect(p.imgMaxEdge).toBe(2800);
        expect(p.imgQuality).toBe(88); // 90 - 2
    });

    it("leaves a normal singleton unresized", () => {
        expect(ctx({ archetype: "singleton" as ImageArchetype }).imgMaxEdge).toBeNull();
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
