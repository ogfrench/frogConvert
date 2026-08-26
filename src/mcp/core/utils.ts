import type { FormatHandler, FileFormat } from "../../core/FormatHandler/FormatHandler.ts";

const LIBREOFFICE_EXTS = new Set(["pptx", "docx", "xlsx", "ppt", "odt", "odp", "ods"]);

/**
 * Returns an install hint when an office-to-PDF conversion would succeed with
 * LibreOffice installed but the handler is currently unavailable.
 */
export function libreofficeHint(
    allHandlers: FormatHandler[],
    inputExt: string,
    outputExt: string
): string | null {
    if (!LIBREOFFICE_EXTS.has(inputExt) || outputExt !== "pdf") return null;
    const lo = allHandlers.find(h => h.name === "libreoffice");
    if (lo && !lo.ready) {
        return "Tip: Install LibreOffice (https://libreoffice.org) to enable high-quality office-to-PDF conversion.";
    }
    return null;
}

/**
 * Finds the corresponding FormatHandler and FileFormat for a given mime type and extension.
 *
 * @param handlers - Array of supported FormatHandlers
 * @param mime - The requested MIME type
 * @param extension - The requested file extension
 * @param direction - Optional: 'from' requires the format to support reading, 'to' requires writing
 * @returns An object containing the format and handler if found, otherwise undefined.
 */
export function findFormatAndHandler(
    handlers: FormatHandler[],
    mime: string,
    extension: string,
    direction?: 'from' | 'to'
): { format: FileFormat; handler: FormatHandler } | undefined {
    return findFormatCandidates(handlers, mime, extension, direction)[0];
}

/**
 * Every registry entry a (mime, token) pair could mean, best first.
 *
 * A token is rarely unique. `json` matches nineteen entries across the
 * registry, `png` thirty; `pdf` matches Ghostscript's writer and pdftoimg's
 * reader. Picking the first one in handler order - what this module did until
 * this function existed - resolved `json` to pandoc's `csljson`, a bibliography
 * format, so every server-side json route parsed ordinary JSON as CSL and
 * `csv -> json` emitted CSL. It resolved `pdf` as an output to Ghostscript,
 * which only writes PDF from PDF, so `md -> pdf` and `epub -> pdf` reported no
 * path at all while their landing pages advertised them.
 *
 * The web UI never hit this: it hands the graph the exact FileFormat the user
 * picked from the list. Only the callers that resolve a token - MCP's
 * convert_file and find_conversion_path, and the REST /convert and /path -
 * have to guess, so the guess is made here, once.
 *
 * An exact `format` match ranks above an entry that only matched on
 * `extension`, which is the difference between "JSON" and "CSL JSON" as a user
 * reading the format list would see it. Ties keep handler order, so the
 * priority baked into the handler list still decides.
 */
export function findFormatCandidates(
    handlers: FormatHandler[],
    mime: string,
    extension: string,
    direction?: 'from' | 'to'
): Array<{ format: FileFormat; handler: FormatHandler }> {
    const exact: Array<{ format: FileFormat; handler: FormatHandler }> = [];
    const byExtension: Array<{ format: FileFormat; handler: FormatHandler }> = [];
    for (const h of handlers) {
        if (!h.supportedFormats) continue;
        for (const f of h.supportedFormats) {
            if (f.mime !== mime) continue;
            if (f.extension !== extension && f.format !== extension) continue;
            if (direction === 'from' && !f.from) continue;
            if (direction === 'to' && !f.to) continue;
            (f.format === extension ? exact : byExtension).push({ format: f, handler: h });
        }
    }
    return [...exact, ...byExtension];
}

/**
 * Hard cap on how many source/target pairings `findFirstPath` will search.
 *
 * `png` alone offers thirty readers, so the full cross product of an ambiguous
 * pair is thousands of searches. Twenty-four is what scripts/verify-conversions.ts
 * has used to clear all 59 landing-page pairs, and a search that finds nothing
 * returns in well under a second, so the cap is a guard against pathological
 * tokens rather than a limit the normal case comes near.
 */
const MAX_PAIRINGS = 24;

/**
 * The first conversion path between two format tokens, or null.
 *
 * Tries the candidate pairings in rank order rather than committing to one
 * reading of each token up front: a token can resolve to an entry that is a
 * legitimate reader or writer and still be a dead end for this particular
 * target, and the next candidate down is often the one that routes. This is
 * the same strategy scripts/verify-conversions.ts uses to prove the pairs work.
 */
export async function findFirstPath(
    graph: {
        searchPath(
            from: { format: FileFormat; handler: FormatHandler },
            to: { format: FileFormat; handler: FormatHandler },
            simpleMode: boolean,
        ): AsyncGenerator<Array<{ format: FileFormat; handler: FormatHandler }>>;
    },
    handlers: FormatHandler[],
    inputMime: string,
    inputExtension: string,
    outputMime: string,
    outputExtension: string,
    simpleMode: boolean,
): Promise<Array<{ format: FileFormat; handler: FormatHandler }> | null> {
    const sources = findFormatCandidates(handlers, inputMime, inputExtension, 'from');
    const targets = findFormatCandidates(handlers, outputMime, outputExtension, 'to');

    let attempts = 0;
    for (const from of sources) {
        for (const to of targets) {
            if (++attempts > MAX_PAIRINGS) return null;
            const result = await graph.searchPath(from, to, simpleMode).next();
            if (!result.done && result.value) return result.value;
        }
    }
    return null;
}
