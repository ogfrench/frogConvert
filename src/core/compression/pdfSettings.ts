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
 * Full argv for a pdfwrite pass. `-dNOPAUSE -dBATCH` stop it waiting for input,
 * `-dQUIET` keeps stdout off our progress channel, and CompatibilityLevel 1.4
 * is the widest-supported output that still allows the object streams we want.
 *
 * No `-dSAFER`: the build is Ghostscript 9.56, where SAFER is the default and
 * the flag is a no-op, and it runs against an Emscripten MEMFS holding nothing
 * but the one input file — there is no host filesystem to reach in the first
 * place. Noted because "where is -dSAFER" is the obvious thing to ask here.
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
