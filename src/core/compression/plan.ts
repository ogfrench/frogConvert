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

/**
 * Base x264 CRF per preset. Roughly ±3 CRF halves or doubles the bitrate, so
 * this is the knob that makes the levels mean something.
 *
 * Video used to have no such knob: the preset only moved the size thresholds
 * below, and every video under 75 MB fell past all of them to a hardcoded
 * CRF 23. That made "Smallest file", "Balanced" and "High quality" produce
 * byte-identical output for the overwhelming majority of real clips - a
 * 17 MB screen recording hit the same branch at all three. Images and audio
 * always scaled their quality by preset (see `planImage`/`planAudio`); this
 * brings video in line.
 *
 * `medium` keeps 23 so the default output is unchanged.
 */
function videoCrf(preset: QualityPreset): number {
  return preset === "low" ? 28 : preset === "high" ? 20 : 23;
}

export function planVideo(inputBytes: number, preset: QualityPreset): CompressionPlan {
  if (preset === "lossless") return { videoCrf: 0, imgQuality: 100 };
  const s = tierScale(preset);
  const crf = videoCrf(preset);
  // The huge-file tier leans two steps harder still: at this size the file is
  // unusable as-is and a little more loss is the lesser cost.
  if (inputBytes > 1000 * MB / s) {
    return { videoCrf: crf + 2, videoScaleFilter: "scale=-2:'min(1080,ih)'", videoMaxrate: "6M", imgQuality: 82 };
  }
  if (inputBytes > 150 * MB / s) {
    return { videoCrf: crf, videoScaleFilter: "scale=-2:'min(1440,ih)'", videoMaxrate: "10M", imgQuality: 82 };
  }
  return { videoCrf: crf, imgQuality: 82 };
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

/**
 * Long-edge cap per preset, in pixels.
 *
 * This is where image compression actually lives, and it used to be missing:
 * a resize only happened above 30 megapixels, which no phone or camera photo
 * reaches, so every ordinary picture kept its full dimensions at every level.
 * Quality alone then had to carry the whole ladder, and it could not - a 12 MP
 * photo re-encoded at the same size is a modest saving however far the quality
 * number drops, because the pixel count is the file.
 *
 * Halving the long edge quarters the pixels. That is the lever.
 */
const PRESET_MAX_EDGE: Record<Exclude<QualityPreset, "lossless">, number | null> = {
  // 1920 is still a full-screen image on almost any display, and 4032x3024
  // (a stock phone photo) drops to 1920x1440 - 77% fewer pixels before
  // quality is even considered.
  low: 1920,
  // Comfortably past 1440p, so a retina display still has pixels to spare.
  medium: 2560,
  // "High quality" means keep what you have; only the quality knob moves.
  high: null,
};

export function planImage(ctx: ImageContext): CompressionPlan {
  const { pixelCount, preset, outputLossless, archetype } = ctx;
  if (preset === "lossless") return { imgQuality: 100, imgMaxEdge: null };

  // Archetype is now an offset rather than the base, so the preset is what
  // decides the ballpark and the archetype nudges it. A single hand-picked
  // photo is worth more than one of six hundred video frames, but not so much
  // more that "Smallest file" on a photo lands where other tools put "high".
  const archetypeOffset =
    archetype === "singleton"      ? 0 :
    archetype === "document-page"  ? -3 :
    archetype === "animated-frame" ? -8 :
    /* video-frame */                -12;

  // The band used to be 82 / 90 / 93 - all three inside what every other tool
  // calls high quality, and only 11 points wide. Squoosh ships at 75 by
  // default; iLoveIMG and TinyPNG's aggressive presets sit near 65 and resize
  // as well. A setting labelled "Visible quality loss" has to be able to
  // deliver some.
  const byPreset =
    preset === "low"  ? 65 :
    preset === "high" ? 93 :
    /* medium */        80;

  const q = outputLossless ? 100
    : Math.min(95, Math.max(45, byPreset + archetypeOffset));

  // Frame dumps carry their own ceiling on top of the preset's: a 4K source
  // under `high` keeps its detail, everything else clamps for ZIP sanity.
  const hardEdge =
    archetype === "video-frame"
      ? (preset === "high" ? 3840 : 1920)
      : archetype === "animated-frame" ? 1920
      : null;

  // Whichever cap is tighter wins.
  const presetEdge = PRESET_MAX_EDGE[preset];
  const edge = hardEdge != null && presetEdge != null
    ? Math.min(hardEdge, presetEdge)
    : hardEdge ?? presetEdge;

  // A genuinely enormous source gets clamped harder still, and gives up a
  // couple more quality points on top.
  const s = tierScale(preset);
  if (pixelCount > 60 * MB / s) {
    return {
      imgMaxEdge: Math.min(edge ?? 2800, 2800),
      imgQuality: Math.max(q - 2, 45),
    };
  }
  return { imgMaxEdge: edge, imgQuality: q };
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
