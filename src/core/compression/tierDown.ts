import type { QualityPreset } from "../FormatHandler/FormatHandler.ts";
import type { InputTier } from "./inputQuality.ts";

export type TierDownResult =
  | { kind: "compress"; tier: QualityPreset }
  | { kind: "skip"; reason: "already-minimal" };

/**
 * Map a detected input quality tier to the next-step output preset. The web
 * UI has no quality selector, so this is the primary way a preset is chosen
 * for same-format compression. MCP/API callers can still pass `quality`
 * explicitly; callers decide whether to consult this.
 */
export function tierDown(inputTier: InputTier, mime = ""): TierDownResult {
  const stepped: TierDownResult = ((): TierDownResult => {
    switch (inputTier) {
      case "uncompressed": return { kind: "compress", tier: "high" };
      case "hq":           return { kind: "compress", tier: "medium" };
      case "medium":       return { kind: "compress", tier: "low" };
      case "low":          return { kind: "compress", tier: "low" };
      case "minimal":      return { kind: "skip", reason: "already-minimal" };
    }
  })();

  // PDF is the one format where a *lower* preset can produce a *bigger* file,
  // so "compress harder" is not a safe default here the way it is for a JPEG.
  // Ghostscript's lower presets decode embedded JPEG2000 and re-encode it, and
  // on a modern well-produced PDF that trade goes the wrong way. Measured on a
  // 71-page research brief: /screen grew it 42%, /ebook grew it 65%, /printer
  // shrank it 18%. A 59-page report shrank at all three (56%/32%/37%) — so
  // /printer is the only preset that helped both.
  //
  // Automatic therefore aims for the reliable win rather than the largest one:
  // 300 dpi still downsamples any real scan, which is where the big savings
  // are, and anyone who wants to push further can pick a level by hand.
  if (stepped.kind === "compress" && mime === "application/pdf") {
    return { kind: "compress", tier: "high" };
  }
  return stepped;
}
