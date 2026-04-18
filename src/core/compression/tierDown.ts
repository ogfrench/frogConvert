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
export function tierDown(inputTier: InputTier): TierDownResult {
  switch (inputTier) {
    case "uncompressed": return { kind: "compress", tier: "high" };
    case "hq":           return { kind: "compress", tier: "medium" };
    case "medium":       return { kind: "compress", tier: "low" };
    case "low":          return { kind: "compress", tier: "low" };
    case "minimal":      return { kind: "skip", reason: "already-minimal" };
  }
}
