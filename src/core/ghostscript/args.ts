import type { QualityPreset } from "../FormatHandler/FormatHandler.ts";
import { pdfSettingsFor } from "../compression/pdfSettings.ts";

/**
 * Ghostscript argv for the *conversion* routes — the PostScript family, PDF/A
 * and multi-page TIFF. Compression keeps its own builder in
 * `core/compression/pdfSettings.ts`; the two share `GS_BASE_FLAGS` so the
 * invariants live in one place, but they answer different questions and are
 * deliberately not merged into one union-typed mega-builder.
 *
 * Every device named here was verified against the shipped binary rather than
 * assumed — `scripts/gs-devices.mjs` prints what is actually compiled in, and
 * `scripts/gs-postscript-probe.mjs` runs each route end to end. The trimmed
 * WASM build does not carry stock Ghostscript's full device set.
 */

/**
 * `-dNOPAUSE -dBATCH` stop it waiting for input; `-dQUIET` keeps its chatter
 * off our progress channel.
 *
 * No `-dSAFER`: this is Ghostscript 9.56, where SAFER is already the default,
 * and it runs against an Emscripten MEMFS holding nothing but the input file —
 * there is no host filesystem to reach. Noted because "where is -dSAFER" is
 * the obvious thing to ask.
 */
export const GS_BASE_FLAGS = ["-dNOPAUSE", "-dQUIET", "-dBATCH"] as const;

/** A conversion this module knows how to build arguments for. */
export type GsRoute = "pdf" | "pdfa" | "ps" | "eps" | "tiff";

/**
 * EPS is single-page *by definition*, and this is a trap with teeth:
 * pointing `eps2write` at a multi-page PDF exits 0, prints its complaint to a
 * stream we silence, and writes a file containing one page. Measured on a
 * 3-page source: the result round-tripped back to a 1-page PDF, silently
 * losing two thirds of the document.
 *
 * The `%d` template is the documented fix — Ghostscript then writes one file
 * per page. So EPS always uses it, even for a 1-page input, and the handler
 * collects however many files came out.
 */
export function needsPerPageOutput(route: GsRoute): boolean {
    return route === "eps";
}

/** Dots per inch for the raster routes, by quality preset. */
function tiffDpi(quality: QualityPreset): number {
    if (quality === "low") return 96;
    if (quality === "high" || quality === "lossless") return 300;
    return 150;
}

export type GsConvertOpts = {
    route: GsRoute;
    inputPath: string;
    /** For EPS this must carry a `%d`; use `needsPerPageOutput` to decide. */
    outputPath: string;
    /** Raster resolution, and the distiller preset on the vector routes. */
    quality?: QualityPreset;
    /** Set for EPS input so the artwork's own bounding box wins over a page size. */
    epsCrop?: boolean;
};

export function gsConvertArgs(opts: GsConvertOpts): string[] {
    const { route, inputPath, outputPath, quality = "medium", epsCrop = false } = opts;
    const args: string[] = [];

    // The distiller preset governs image downsampling, and it is the only thing
    // the chosen level can change on these routes. Leaving it off made the
    // control decoration: measured on an image-heavy source, `PS → PDF` came
    // out at 441,968 B whatever the user picked, against a real range of
    // 127,981 B (/screen) to 1,923,019 B (/prepress). Same defect the video
    // levels had before this release.
    const distiller = `-dPDFSETTINGS=${pdfSettingsFor(quality)}`;

    switch (route) {
        case "pdf":
            args.push("-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.4", distiller);
            break;
        case "pdfa":
            // PDFA=2 is PDF/A-2b. CompatibilityPolicy=1 tells Ghostscript to
            // drop whatever cannot be represented rather than abandoning the
            // conversion, which is the behaviour someone asking for an
            // archival copy wants. Device-independent colour is a hard
            // requirement of the standard, not a preference.
            args.push(
                "-sDEVICE=pdfwrite",
                "-dPDFA=2",
                "-dPDFACompatibilityPolicy=1",
                "-sColorConversionStrategy=UseDeviceIndependentColor",
                // Verified that downsampling does not cost compliance: the
                // output still carries its pdfaid marker at every preset.
                distiller,
            );
            break;
        case "ps":
            args.push("-sDEVICE=ps2write", distiller);
            break;
        case "eps":
            args.push("-sDEVICE=eps2write", distiller);
            break;
        case "tiff":
            // Colour, LZW, always. `tiff24nc`'s default is *uncompressed*, and
            // the difference is not marginal: a 3-page vector PDF at 150 dpi
            // came out at 19,583,480 B raw against 54,929 B with LZW — 356x.
            // Shipping the default would look like a bug to anyone who tried it.
            args.push("-sDEVICE=tiff24nc", "-sCompression=lzw", `-r${tiffDpi(quality)}`);
            break;
    }

    if (epsCrop) args.push("-dEPSCrop");
    args.push(...GS_BASE_FLAGS, `-sOutputFile=${outputPath}`, inputPath);
    return args;
}
