import type { QualityPreset } from "./FormatHandler.ts";

/**
 * Only PDF-rendering knobs live here. Video/GIF/image/audio compression is
 * handled by the tiered planner in `src/core/compression/plan.ts`.
 */
export type QualityPresetConfig = {
  pdfDpi: number;
  pdfMp: number;
  pngCnum: number;
};

export const PRESETS: Record<QualityPreset, QualityPresetConfig> = {
  low:      { pdfDpi: 96,  pdfMp: 1.2, pngCnum: 128 },
  medium:   { pdfDpi: 160, pdfMp: 2.5, pngCnum: 256 },
  high:     { pdfDpi: 240, pdfMp: 5.0, pngCnum: 0   },
  lossless: { pdfDpi: 400, pdfMp: 25,  pngCnum: 0   },
};

export const DEFAULT_PRESET: QualityPreset = "medium";

export function presetFor(quality: QualityPreset | undefined): QualityPresetConfig {
  return PRESETS[quality ?? DEFAULT_PRESET];
}
