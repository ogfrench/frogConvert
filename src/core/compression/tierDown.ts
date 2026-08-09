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
      // Raw or barely-compressed: `medium` already means q80 with a 2560 px
      // cap, which takes an enormous bite out of these without needing the
      // aggressive preset.
      case "uncompressed": return { kind: "compress", tier: "medium" };
      case "hq":           return { kind: "compress", tier: "medium" };
      // An ordinary phone photo lands here. It used to map to `low`, which was
      // harmless while `low` meant q82-and-no-resize - and would now hand
      // someone who asked for nothing in particular a 1920 px q65 image.
      // Automatic has to stay the safe answer; `low` is the escape hatch for
      // people who went looking for it.
      case "medium":       return { kind: "compress", tier: "medium" };
      // Already web-optimised. Squeezing it again trades visible quality for
      // almost no bytes, so take the gentlest setting and let the
      // keep-threshold discard the result if it saves nothing.
      case "low":          return { kind: "compress", tier: "high" };
      case "minimal":      return { kind: "skip", reason: "already-minimal" };
    }
  })();

  // PDF is the one format where a *lower* preset can produce a *bigger* file,
  // so "compress harder" is not a safe default here the way it is for a JPEG.
  // Ghostscript's lower presets decode embedded JPEG2000 and re-encode it, and
  // on a modern well-produced PDF that trade goes the wrong way. Measured on a
  // 71-page research brief: /screen grew it 42%, /ebook grew it 65%, /printer
  // shrank it 18%. A 59-page report shrank at all three (56%/32%/37%) - so
  // /printer is the only preset that helped both.
  //
  // Automatic therefore aims for the reliable win rather than the largest one:
  // 300 dpi still downsamples any real scan, which is where the big savings
  // are, and anyone who wants to push further can pick a level by hand.
  //
  // PDFs also never reach `skip`. The tier is read from bytes per page, which
  // for a PDF says almost nothing about what Ghostscript can do: a long
  // document is thin per page whatever its images cost, so a thesis lands in
  // `minimal` and Automatic used to hand it straight back as "already
  // compressed". Measured on a 5.1 MB, 100+ page LaTeX thesis: Automatic saved
  // nothing while every other level shrank it, /printer by 65% to 1.8 MB. The
  // keep-threshold already discards a result that gains less than 2%, so
  // trying costs the user nothing and refusing costs them 3.3 MB.
  if (mime === "application/pdf") {
    return { kind: "compress", tier: "high" };
  }
  return stepped;
}
