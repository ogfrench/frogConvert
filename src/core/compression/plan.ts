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

export function planImage(pixelCount: number, preset: QualityPreset, outputLossless: boolean): CompressionPlan {
  if (preset === "lossless") return { imgQuality: 100, imgMaxEdge: null };
  const s = tierScale(preset);
  const q = outputLossless ? 100 : (preset === "low" ? 70 : preset === "high" ? 90 : 82);
  if (pixelCount > 40 * MB / s) {
    return { imgMaxEdge: 2400, imgQuality: Math.max(q - 4, 60) };
  }
  if (pixelCount > 16 * MB / s) {
    return { imgMaxEdge: 3200, imgQuality: q };
  }
  return { imgMaxEdge: null, imgQuality: q };
}

/**
 * Audio bitrate lookup by preset and channel count. Stereo gets roughly
 * 1.5× the mono bitrate — enough headroom to keep the stereo image intact
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
