import { hopQualityArgs } from "../../core/compression/hopQuality.ts";
import type { FormatHandler, FileData, QualityPreset } from "../../core/FormatHandler/FormatHandler.ts";
import type { TraversionGraph } from "../../core/TraversionGraph/TraversionGraph.ts";
import { resolveEffectiveQuality } from "../../core/compression/resolveEffectiveQuality.ts";
import { routeQualityNotice } from "../../conversion/routeQuality.ts";
import { appendSupportContact, toUserErrorInfo } from "../../components/utils/index.ts";
import { findFirstPath, libreofficeHint } from "./utils.ts";
import { convertViaBrowser } from "./browserBridge.ts";

export type AgentConversion =
    | { files: FileData[]; warnings: string[] }
    | { error: string; status: number };

type Request = {
    handlers: FormatHandler[];
    graph: TraversionGraph;
    allHandlers?: FormatHandler[];
    fileName: string;
    bytes: Uint8Array;
    inputMime: string;
    inputExt: string;
    outputMime: string;
    outputExt: string;
    quality?: QualityPreset;
};

/**
 * One conversion for the agent surfaces, MCP `convert_file` and REST
 * `/convert`. Each used to carry its own copy of this, and the copies drifted:
 * REST dropped every warning from its JSON response while MCP kept them.
 *
 * Native handlers first, then the browser bridge, which has the browser-only
 * handlers. Two additions over the old copies:
 *
 * - HTML to PDF prints through the bridge's Chrome (real text, the page's own
 *   layout) rather than a native LibreOffice, which loses most CSS: a card's
 *   padding and rounded corners came out as a highlight behind its text.
 *   Markdown and the rest reach it the same way, natively to HTML first.
 *   LibreOffice stays the fallback when the bridge cannot run.
 * - A result that came out as pictures says so, as the web UI does, so an
 *   agent is not told a PDF has text it does not have.
 */
export async function convertForAgents(req: Request): Promise<AgentConversion> {
    const { handlers, graph, allHandlers, fileName, bytes, inputMime, inputExt, outputMime, outputExt, quality } = req;
    const resolved = await resolveEffectiveQuality(quality, bytes, inputMime, outputMime);
    if (resolved === null) {
        // Already minimal: the input comes back unchanged.
        return { files: [{ name: fileName, bytes }], warnings: [] };
    }

    let nativeFailure: unknown = null;
    // simpleMode=true: see findFirstPath. The graph keys nodes by format, so a
    // handler-constrained search only rejected good routes for longer ones.
    const path = await findFirstPath(graph, handlers, inputMime, inputExt, outputMime, outputExt, true);
    if (path) {
        let files: FileData[] = [{ name: fileName, bytes }];
        const formats = path.map(n => n.format.format);
        const htmlAt = formats.length >= 2 && formats.at(-1) === "pdf" && formats.at(-2) === "html"
            ? formats.length - 2 : -1;
        try {
            if (htmlAt >= 0) {
                files = await runHops(path, files, 1, htmlAt, resolved);
                const printed = await printViaBridge(files[0], resolved);
                if (printed) return printed;
                // No bridge: finish natively (LibreOffice).
                files = await runHops(path, files, htmlAt + 1, path.length - 1, resolved);
            } else {
                files = await runHops(path, files, 1, path.length - 1, resolved);
            }
            return { files, warnings: warningsFor(formats, files) };
        } catch (e) {
            nativeFailure = e;
            process.stderr.write(`[agents] Native conversion failed, trying browser bridge: ${(e as Error)?.message ?? e}\n`);
        }
    }

    // No native path, a format the native registry does not know, or native
    // execution failed: the bridge has every handler, browser-only ones too.
    try {
        const results = await convertViaBrowser(
            fileName, Buffer.from(bytes).toString("base64"), inputMime, inputExt, outputMime, outputExt, resolved,
        );
        const files: FileData[] = results.map(r => ({
            name: r.fileName,
            bytes: new Uint8Array(Buffer.from(r.base64Bytes, "base64")),
        }));
        return { files, warnings: Array.from(new Set(results.flatMap(r => r.warnings ?? []))) };
    } catch (bridgeErr) {
        const bridgeInfo = toUserErrorInfo(bridgeErr);
        const nativeInfo = nativeFailure ? toUserErrorInfo(nativeFailure) : null;
        let msg = nativeInfo?.kind === "unknown" || nativeInfo?.kind === "runtime_failure"
            ? "Something went wrong while converting this file."
            : bridgeInfo.message || "Something went wrong while converting this file.";
        const hint = allHandlers && libreofficeHint(allHandlers, inputExt, outputExt);
        if (hint) msg += `\n${hint}`;
        return { error: appendSupportContact(msg), status: 422 };
    }
}

/** Run hops `from`..`to` of a native path (path[0] is the input; hops start at 1). */
async function runHops(
    path: NonNullable<Awaited<ReturnType<typeof findFirstPath>>>,
    start: FileData[],
    from: number,
    to: number,
    requested: QualityPreset,
): Promise<FileData[]> {
    let files = start;
    for (let i = from; i <= to; i++) {
        files = await path[i].handler.doConvert(files, path[i - 1].format, path[i].format,
            hopQualityArgs({ target: path[i].format, isLastHop: i === path.length - 1, requested }));
    }
    return files;
}

/** HTML to PDF through the bridge's Chrome; null when the bridge cannot run. */
async function printViaBridge(html: FileData, quality: QualityPreset): Promise<AgentConversion | null> {
    try {
        const results = await convertViaBrowser(
            html.name, Buffer.from(html.bytes).toString("base64"), "text/html", "html", "application/pdf", "pdf", quality,
        );
        const files: FileData[] = results.map(r => ({
            name: r.fileName,
            bytes: new Uint8Array(Buffer.from(r.base64Bytes, "base64")),
        }));
        return { files, warnings: Array.from(new Set(results.flatMap(r => r.warnings ?? []))) };
    } catch (e) {
        process.stderr.write(`[agents] Browser print unavailable, finishing natively: ${(e as Error)?.message ?? e}\n`);
        return null;
    }
}

/** The handlers' own warnings, plus the route's, as the web UI shows it. */
function warningsFor(formats: string[], files: FileData[]): string[] {
    const notice = routeQualityNotice(formats, files.some(f => f.drawnAsImage));
    const all = files.flatMap(f => f.warnings ?? []);
    if (notice) all.push(`${notice.title}. ${notice.body}`);
    return Array.from(new Set(all));
}
