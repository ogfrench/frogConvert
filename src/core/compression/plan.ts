import type { QualityPreset } from "../FormatHandler/FormatHandler.ts";

export type CompressionPlan = {
  videoCrf?: number;
  videoScaleFilter?: string;
  videoMaxrate?: string;
  gifScaleFilter?: string;
  gifFps?: number;
  imgMaxEdge?: number | null;
  imgQuality: number;
  audioKbps?: number | null;
};

/**
 * Per-preset threshold divisor. A `low` user gets tiers that fire at **half**
 * the medium threshold (more aggressive: small files still get compressed);
 * a `high` user gets tiers that fire at **double** (more lenient: even big
 * files may pass through). `lossless` bypasses tier logic entirely.
 */
function tierScale(preset: QualityPreset): number {
  switch (preset) {
    case "low": return 2;
    case "medium": return 1;
    case "high": return 0.5;
    case "lossless": return 0;
  }
}

const MB = 1_000_000;

export function planVideo(inputBytes: number, preset: QualityPreset): CompressionPlan {
  if (preset === "lossless") return { videoCrf: 0, imgQuality: 100 };
  const s = tierScale(preset);
  if (inputBytes > 1000 * MB / s) {
    return { videoCrf: 25, videoScaleFilter: "scale=-2:'min(1080,ih)'", videoMaxrate: "6M", imgQuality: 82 };
  }
  if (inputBytes > 150 * MB / s) {
    return { videoCrf: 23, videoScaleFilter: "scale=-2:'min(1440,ih)'", videoMaxrate: "10M", imgQuality: 82 };
  }
  return { videoCrf: 23, imgQuality: 82 };
}

export function planGif(inputBytes: number, preset: QualityPreset): CompressionPlan {
  if (preset === "lossless") return { imgQuality: 100 };
  const s = tierScale(preset);
  if (inputBytes > 30 * MB / s) {
    return { gifScaleFilter: "scale='min(480,iw)':-1:flags=lanczos", gifFps: 15, imgQuality: 82 };
  }
  if (inputBytes > 10 * MB / s) {
    return { gifScaleFilter: "scale='min(960,iw)':-1:flags=lanczos", gifFps: 24, imgQuality: 82 };
  }
  if (inputBytes > 2 * MB / s) {
    return { gifScaleFilter: "scale='min(1080,iw)':-1:flags=lanczos", gifFps: 24, imgQuality: 82 };
  }
  return { imgQuality: 82 };
}

/**
 * Image output archetype. The same output file can mean very different
 * things depending on where it comes from: a single hand-picked photo
 * deserves max quality, one of 600 video frames doesn't. Handlers pass
 * this alongside the pixel count so the planner can pick a budget that
 * matches the user's real intent.
 */
export type ImageArchetype =
  | "singleton"        // one image in → one image out (HEIC→JPEG, PNG→WebP)
  | "document-page"    // PDF page rasterization; text-heavy, crispness matters
  | "animated-frame"   // GIF/WebP/APNG frame extraction; ~tens to hundreds
  | "video-frame";     // MP4→PNG/JPEG frame dump; potentially thousands

export type ImageContext = {
  pixelCount: number;
  preset: QualityPreset;
  outputLossless: boolean;
  archetype: ImageArchetype;
};

export function planImage(ctx: ImageContext): CompressionPlan {
  const { pixelCount, preset, outputLossless, archetype } = ctx;
  if (preset === "lossless") return { imgQuality: 100, imgMaxEdge: null };

  const qBase =
    archetype === "singleton"      ? 90 :
    archetype === "document-page"  ? 87 :
    archetype === "animated-frame" ? 82 :
    /* video-frame */                78;

  const q = outputLossless ? 100
    : Math.min(95, Math.max(60,
        preset === "low"  ? qBase - 8 :
        preset === "high" ? qBase + 3 :
        qBase));

  // Video frames respect preset so a 4K source under `high` keeps its detail,
  // while the web default (`medium`) still clamps to 1080p for ZIP sanity.
  const hardEdge =
    archetype === "video-frame"
      ? (preset === "high" ? 3840 : 1920)
      : archetype === "animated-frame" ? 1920
      : null;

  const s = tierScale(preset);
  if (pixelCount > 60 * MB / s) {
    return { imgMaxEdge: Math.min(hardEdge ?? 2800, 2800), imgQuality: Math.max(q - 2, 70) };
  }
  return { imgMaxEdge: hardEdge, imgQuality: q };
}

/**
 * Audio bitrate lookup by preset and channel count. Stereo gets roughly
 * 1.5× the mono bitrate, enough headroom to keep the stereo image intact
 * at every tier. Lossless output bypasses the whole table.
 */
export function planAudio(outputLossless: boolean, channels: number, preset: QualityPreset): CompressionPlan {
  if (outputLossless || preset === "lossless") return { audioKbps: null, imgQuality: 100 };
  const stereo = channels !== 1;
  const kbps = preset === "low" ? (stereo ? 128 : 96)
             : preset === "high" ? (stereo ? 256 : 160)
             : (stereo ? 192 : 128);
  return { audioKbps: kbps, imgQuality: 82 };
}
