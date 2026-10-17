import normalizeMimeType from "../utils/normalizeMimeType.ts";
import type { FileFormat, FormatHandler } from "./FormatHandler.ts";

/**
 * Detect which of the loaded format options a dropped file is, by MIME then
 * extension. Lives in core so any surface (Converter, Compress) can identify
 * a file without importing the convert pipeline.
 */
/**
 * Other spellings of an extension a format declares. A format declares one
 * extension, so a file spelled the other way matched nothing whenever the
 * browser sent no MIME type (some drag-and-drop paths and OSes send none) and
 * was refused as unsupported: `.htm`, `.tif`, `.yaml`, `.jfif` (what Windows
 * often saves JPEGs as), and the rest below. Only true synonyms belong here.
 */
const EXTENSION_ALIASES: Record<string, string> = {
    htm: "html", tif: "tiff", yaml: "yml", midi: "mid", markdown: "md", mkd: "md",
    mpeg: "mpg", aiff: "aif", jfif: "jpg", wave: "wav", oga: "ogg",
};

/** The other spellings of a declared extension, for a file picker's accept list. */
export function aliasesOf(ext: string): string[] {
    return Object.keys(EXTENSION_ALIASES).filter(a => EXTENSION_ALIASES[a] === ext);
}

/**
 * The extensions a file name may be matched on, most specific first: its own
 * (lower-cased), then the declared spelling it is an alias of. Empty without a
 * dot.
 */
export function fileExtensionsOf(name: string): string[] {
    const dotIdx = name.lastIndexOf(".");
    if (dotIdx <= 0) return [];
    const ext = name.slice(dotIdx + 1).toLowerCase();
    const alias = EXTENSION_ALIASES[ext];
    return alias ? [ext, alias] : [ext];
}

export function findMatchingFormat(
    files: File[],
    allOptions: Array<{ format: FileFormat; handler: FormatHandler }>,
): number {
    // Intentionally format-mode-agnostic: detect the real format regardless of the
    // current display mode. refreshUI() re-runs after each handler phase and handles
    // switching to the matched category tab if the format wasn't yet loaded on upload.
    const mimeType = normalizeMimeType(files[0].type);
    // Only treat a trailing segment as an extension when there's an actual dot
    // in the filename. Otherwise `"photo".split(".").pop()` returns the whole
    // name, which would accidentally match a format whose extension happened
    // to equal the filename.
    const fileExtensions = fileExtensionsOf(files[0].name);
    // Best match: MIME + extension
    let mimeMatch = -1;
    for (let i = 0; i < allOptions.length; i++) {
        const { format } = allOptions[i];
        if (!format.from || format.mime !== mimeType) continue;

        // Lower-cased on both sides, matching the extension-only pass below -
        // the two used to disagree, so a format declared with an upper-case
        // extension could only ever be found by the fallback.
        if (fileExtensions.includes(format.extension.toLowerCase())) return i;
        if (mimeMatch === -1) mimeMatch = i; // First MIME-only match as fallback
    }

    // An exact extension match beats a MIME-only one. The browser's MIME is a
    // guess derived from an OS table and is routinely wrong or absent, whereas
    // an extension a format explicitly claims is a deliberate statement.
    //
    // `.ai` is what forced the ordering: a modern Illustrator file is a PDF
    // internally, so it can arrive as `application/pdf`. With the MIME fallback
    // first that landed on the plain PDF entry - the file converted, looked
    // fine, and silently lost its Illustrator payload. Nothing is lost the
    // other way round: a MIME with no matching extension still falls through
    // to `mimeMatch` below.
    // The file's own spelling first, so a format that declares it outranks
    // one that declares the spelling it is an alias of.
    for (const ext of fileExtensions) {
        for (let i = 0; i < allOptions.length; i++) {
            const { format } = allOptions[i];
            if (format.from && format.extension.toLowerCase() === ext) {
                return i;
            }
        }
    }

    if (mimeMatch !== -1) return mimeMatch;

    return -1;
}
