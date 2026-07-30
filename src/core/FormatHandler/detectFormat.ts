import normalizeMimeType from "../utils/normalizeMimeType.ts";
import type { FileFormat, FormatHandler } from "./FormatHandler.ts";

/**
 * Detect which of the loaded format options a dropped file is, by MIME then
 * extension. Lives in core so any surface (Converter, Compress) can identify
 * a file without importing the convert pipeline.
 */
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
    const name = files[0].name;
    const dotIdx = name.lastIndexOf(".");
    const fileExtension = dotIdx > 0 ? name.slice(dotIdx + 1).toLowerCase() : undefined;
    // Best match: MIME + extension
    let mimeMatch = -1;
    for (let i = 0; i < allOptions.length; i++) {
        const { format } = allOptions[i];
        if (!format.from || format.mime !== mimeType) continue;

        // Lower-cased on both sides, matching the extension-only pass below —
        // the two used to disagree, so a format declared with an upper-case
        // extension could only ever be found by the fallback.
        if (fileExtension && format.extension.toLowerCase() === fileExtension) return i;
        if (mimeMatch === -1) mimeMatch = i; // First MIME-only match as fallback
    }
    if (mimeMatch !== -1) return mimeMatch;

    // Fallback: extension-only match
    if (fileExtension) {
        for (let i = 0; i < allOptions.length; i++) {
            const { format } = allOptions[i];
            if (format.from && format.extension.toLowerCase() === fileExtension) {
                return i;
            }
        }
    }

    return -1;
}
