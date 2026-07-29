import type { QualityPreset } from "../FormatHandler/FormatHandler.ts";

/**
 * Compression engine — PDF settings. Maps a quality preset onto the
 * Ghostscript distiller preset that implements it.
 *
 * Kept separate from the handler so the mapping is testable without loading a
 * 16 MB WASM binary, and so the agent surfaces (MCP/REST/CLI) can reuse it if
 * they ever gain a native `gs` path.
 *
 * Ghostscript's own preset names describe intent, not amount: `/screen` targets
 * 72 dpi images, `/ebook` 150 dpi, `/printer` and `/prepress` 300 dpi. Note the
 * presets only bound *image* resampling — text and vector content is untouched,
 * which is why a text-only PDF barely shrinks at any level. See
 * `expectedSavingsNote` for the copy that admits this to the user.
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
 * Full argv for a pdfwrite pass. `-dNOPAUSE -dBATCH` stop it waiting for input,
 * `-dQUIET` keeps stdout off our progress channel, and CompatibilityLevel 1.4
 * is the widest-supported output that still allows the object streams we want.
 */
export function ghostscriptArgs(opts: {
    quality: QualityPreset;
    inputPath: string;
    outputPath: string;
}): string[] {
    return [
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.4",
        `-dPDFSETTINGS=${pdfSettingsFor(opts.quality)}`,
        "-dNOPAUSE",
        "-dQUIET",
        "-dBATCH",
        `-sOutputFile=${opts.outputPath}`,
        opts.inputPath,
    ];
}

/**
 * Honest expectation-setting, keyed off what the probe found rather than a
 * blanket promise. Scans are mostly embedded raster and shrink a lot; a text
 * whitepaper is fonts and vectors and will barely move, and claiming otherwise
 * makes the feature look broken when it is working correctly.
 */
export function expectedSavingsNote(bytesPerPage: number): string {
    if (bytesPerPage > 1_000_000) return "Looks image-heavy — expect a big drop.";
    if (bytesPerPage > 300_000) return "Mixed text and images — expect a moderate drop.";
    return "Looks text-heavy, so there's little to squeeze — expect only a small drop.";
}
