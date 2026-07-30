import { describe, it, expect, vi, afterEach } from "vitest";
import { probeInputQuality, probeImage, probePdf, probeAudioVideo } from "./inputQuality.ts";

// Build bytes that probeInputQuality will treat as a PDF: pad to >1MB (above
// the probe-skip threshold) and stamp `/Count <n>` in the last 32KB so the
// trailer scan finds it. Actual PDF syntax isn't needed, the probe only
// looks for /Count matches via regex.
// Place the marker ~16 bytes from EOF, close enough to the tail to land
// inside the trailer scan window, far enough that there's room for a few
// closing bytes without overlapping the marker itself.
function makePdfBytes(pageCount: number, totalBytes: number): Uint8Array {
    const buf = new Uint8Array(Math.max(totalBytes, 2_000_000));
    const marker = new TextEncoder().encode(`/Type /Pages /Count ${pageCount} /Kids []`);
    buf.set(marker, buf.length - marker.length - 16);
    return buf;
}

// Build a minimal PNG with the IHDR chunk carrying the given dimensions. The
// rest of the file is zero-padded to hit the bytes-per-megapixel tier we want.
function makePng(width: number, height: number, totalBytes: number): Uint8Array {
    const buf = new Uint8Array(Math.max(totalBytes, 24));
    buf.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 0);
    buf.set([0x49, 0x48, 0x44, 0x52], 12);
    const view = new DataView(buf.buffer);
    view.setUint32(16, width, false);
    view.setUint32(20, height, false);
    return buf;
}

// Build a minimal JPEG with SOI + SOF0 payload carrying height/width.
function makeJpeg(width: number, height: number, totalBytes: number): Uint8Array {
    const buf = new Uint8Array(Math.max(totalBytes, 24));
    buf[0] = 0xFF; buf[1] = 0xD8; // SOI
    buf[2] = 0xFF; buf[3] = 0xC0; // SOF0
    const view = new DataView(buf.buffer);
    view.setUint16(4, 17, false);  // segment length (any >= 7)
    buf[6] = 8;                    // precision
    view.setUint16(7, height, false);
    view.setUint16(9, width, false);
    return buf;
}

describe("probeInputQuality (unknown / size-band fallback)", () => {
    it("returns 'medium' for unknown mime (empty string)", async () => {
        const bytes = new Uint8Array(1024);
        const r = await probeInputQuality(bytes, "");
        expect(r.inputTier).toBe("medium");
    });

    it("uses size bands for arbitrary binary types above the skip threshold", async () => {
        const small = new Uint8Array(2_000_000);
        const big = new Uint8Array(20_000_000);
        const huge = new Uint8Array(120_000_000);

        expect((await probeInputQuality(small, "application/octet-stream")).inputTier).toBe("medium");
        expect((await probeInputQuality(big, "application/octet-stream")).inputTier).toBe("hq");
        expect((await probeInputQuality(huge, "application/octet-stream")).inputTier).toBe("uncompressed");
    });

    it("skips probing (returns 'medium') for files below the probe threshold", async () => {
        const tiny = new Uint8Array(500);
        expect((await probeInputQuality(tiny, "application/octet-stream")).inputTier).toBe("medium");
    });

    it("audio/video without DOM / decodable bytes falls back to medium", async () => {
        // jsdom has <audio>/<video> but cannot decode arbitrary bytes → loadedmetadata
        // won't fire. The probe must still terminate and return a usable tier.
        const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
        const r = await probeInputQuality(bytes, "audio/mpeg");
        expect(r.inputTier).toBe("medium");
    }, 10_000);
});

describe("probeImage header parsing", () => {
    it("reads PNG dimensions from IHDR and tiers by bytes-per-megapixel", async () => {
        // 1MP PNG at 2.5MB → bpp = 2.5M → above LOSSLESS uncompressed band (2M)
        const big = makePng(1000, 1000, 2_500_000);
        expect((await probeImage(big, "image/png")).inputTier).toBe("uncompressed");

        // 1MP PNG at 1MB → bpp = 1M → between hq (500k) and uncompressed (2M)
        const mid = makePng(1000, 1000, 1_000_000);
        expect((await probeImage(mid, "image/png")).inputTier).toBe("hq");

        // 1MP PNG at 200KB → bpp = 200k → below hq band
        const small = makePng(1000, 1000, 200_000);
        expect((await probeImage(small, "image/png")).inputTier).toBe("medium");
    });

    it("reads JPEG dimensions from SOF0 and tiers by bytes-per-megapixel", async () => {
        // 2MP JPEG at 1.5MB → bpp = 750k → above LOSSY hq band (500k)
        const big = makeJpeg(2000, 1000, 1_500_000);
        expect((await probeImage(big, "image/jpeg")).inputTier).toBe("hq");

        // 2MP JPEG at 500KB → bpp = 250k → between medium (200k) and hq (500k)
        const mid = makeJpeg(2000, 1000, 500_000);
        expect((await probeImage(mid, "image/jpeg")).inputTier).toBe("medium");

        // 2MP JPEG at 100KB → bpp = 50k → below low band
        const tiny = makeJpeg(2000, 1000, 100_000);
        expect((await probeImage(tiny, "image/jpeg")).inputTier).toBe("minimal");
    });

    it("returns UNKNOWN for a garbage PNG-claiming buffer", async () => {
        const junk = new Uint8Array(1_500_000);  // above SKIP_PROBE_BYTES
        // jsdom createImageBitmap also fails on junk → falls through to UNKNOWN
        const r = await probeImage(junk, "image/png");
        expect(r.inputTier).toBe("medium");
    });
});

describe("probePdf trailer scan", () => {
    it("reads /Count from the trailer region and tiers by bytes-per-page", async () => {
        // 2MB file, 20 pages → 100KB/page. This is where the two real-world
        // reports that exposed the miscalibration sit; a designed document at
        // this density compresses by a third, so "low" (compressible) is the
        // right read and the old "minimal" was refusing to try.
        const designed = makePdfBytes(20, 2_000_000);
        expect((await probePdf(designed)).inputTier).toBe("low");

        // 2MB file, 100 pages → 20KB/page → genuinely pure text → minimal
        const textOnly = makePdfBytes(100, 2_000_000);
        expect((await probePdf(textOnly)).inputTier).toBe("minimal");

        // 2MB file, 2 pages → 1MB/page → between medium (500K) and hq (1.5M) → medium
        const medium = makePdfBytes(2, 2_000_000);
        expect((await probePdf(medium)).inputTier).toBe("medium");

        // 10MB file, 1 page → 10MB/page → above uncompressed band (5MB)
        const massive = makePdfBytes(1, 10_000_000);
        expect((await probePdf(massive)).inputTier).toBe("uncompressed");
    });

    it("picks the MAX /Count value (multi-level pages tree)", async () => {
        // Simulate a sub-tree /Count followed by the root /Count. Max wins.
        const buf = new Uint8Array(2_000_000);
        const marker = new TextEncoder().encode("/Count 3 /Kids [... /Count 50 /Kids []]");
        buf.set(marker, buf.length - marker.length - 16);
        // 2MB / 50 pages = 40KB/page → minimal
        expect((await probePdf(buf)).inputTier).toBe("minimal");
    });
});

describe("probeAudioVideo (mocked media element)", () => {
    afterEach(() => { vi.restoreAllMocks(); });

    function mockMediaElement(duration: number) {
        const realCreate = document.createElement.bind(document);
        vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
            if (tag !== "audio" && tag !== "video") return realCreate(tag);
            const el = realCreate(tag) as HTMLMediaElement;
            Object.defineProperty(el, "duration", { configurable: true, get: () => duration });
            Object.defineProperty(el, "src", {
                configurable: true,
                set() { queueMicrotask(() => el.onloadedmetadata?.(new Event("loadedmetadata"))); },
                get() { return ""; },
            });
            return el;
        });
    }

    it("tiers a 5-minute audio file at ~256kbps as hq", async () => {
        mockMediaElement(300);  // 5 minutes
        // 300s * 256kbps / 8 = ~9.6MB. Bump slightly above hq threshold.
        const bytes = new Uint8Array(300 * 257 * 1000 / 8);
        expect((await probeAudioVideo(bytes, "audio/mpeg")).inputTier).toBe("hq");
    });

    it("tiers a 1-minute 1080p video at ~5Mbps as hq", async () => {
        mockMediaElement(60);
        // 60s * 5000kbps / 8 = ~37.5MB. Above hq (4Mbps), below uncompressed (10Mbps).
        const bytes = new Uint8Array(60 * 5000 * 1000 / 8);
        expect((await probeAudioVideo(bytes, "video/mp4")).inputTier).toBe("hq");
    });

    it("treats a lossless audio stream (~1400kbps) as uncompressed", async () => {
        mockMediaElement(60);
        // 60s * 1400kbps / 8 = 10.5MB. Above AUDIO_KBPS.uncompressed (900).
        const bytes = new Uint8Array(60 * 1400 * 1000 / 8);
        expect((await probeAudioVideo(bytes, "audio/wav")).inputTier).toBe("uncompressed");
    });
});
