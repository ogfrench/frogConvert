import type { QualityPreset } from "../FormatHandler/FormatHandler.ts";
import { gsBaseFlags } from "../ghostscript/args.ts";

/**
 * Compression engine - PDF settings. Maps a quality preset onto the
 * Ghostscript distiller preset that implements it.
 *
 * Kept separate from the handler so the mapping is testable without loading a
 * 16 MB WASM binary, and so the agent surfaces (MCP/REST/CLI) can reuse it if
 * they ever gain a native `gs` path.
 *
 * Ghostscript's own preset names describe intent, not amount: `/screen` targets
 * 72 dpi images, `/ebook` 150 dpi, `/printer` and `/prepress` 300 dpi. Note the
 * presets only bound *image* resampling - text and vector content is untouched,
 * which is why a text-only PDF barely shrinks at any level. The Compress
 * results view says so out loud when it happens.
 */

/** Ghostscript `-dPDFSETTINGS` value. */
export type PdfSettingsPreset = "/screen" | "/ebook" | "/printer" | "/prepress";

const BY_PRESET: Record<QualityPreset, PdfSettingsPreset> = {
    // Inverted, like every other preset in this codebase: `low` names the
    // lowest quality *target*, so it compresses hardest.
    low: "/screen",
    medium: "/ebook",
    high: "/printer",
    lossless: "/prepress",
};

export function pdfSettingsFor(quality: QualityPreset): PdfSettingsPreset {
    return BY_PRESET[quality];
}

/**
 * Full argv for a pdfwrite pass. CompatibilityLevel 1.4 is the
 * widest-supported output that still allows the object streams we want; the
 * shared base flags (and the story of the missing `-dSAFER`) live with
 * `gsBaseFlags` in core/ghostscript/args.ts, which builds the argv for the
 * conversion routes the same way.
 */
export function ghostscriptArgs(opts: {
    quality: QualityPreset;
    inputPath: string;
    outputPath: string;
    /**
     * Leave `-dQUIET` off so the pass narrates itself, one line per page.
     * Only for a caller that captures stdout; see `gsBaseFlags`.
     */
    verbose?: boolean;
}): string[] {
    return [
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.4",
        `-dPDFSETTINGS=${pdfSettingsFor(opts.quality)}`,
        ...gsBaseFlags(!opts.verbose),
        `-sOutputFile=${opts.outputPath}`,
        opts.inputPath,
    ];
}
