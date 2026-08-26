import type { FormatHandler } from "../../core/FormatHandler/FormatHandler.ts";
import type { TraversionGraph } from "../../core/TraversionGraph/TraversionGraph.ts";
import { findFirstPath } from "../../mcp/core/utils.ts";
import { canConvertViaBrowser } from "../../mcp/core/browserBridge.ts";
import { appendSupportContact, CONVERSION_NOT_AVAILABLE_TEXT } from "../../components/utils/index.ts";

export async function handlePath(url: URL, handlers: FormatHandler[], graph: TraversionGraph): Promise<Response> {
    const inputMime = url.searchParams.get("inputMime");
    const inputExt = url.searchParams.get("inputExt");
    const outputMime = url.searchParams.get("outputMime");
    const outputExt = url.searchParams.get("outputExt");

    if (!inputMime || !inputExt || !outputMime || !outputExt) {
        return Response.json(
            { error: "Missing required query params: inputMime, inputExt, outputMime, outputExt" },
            { status: 400 }
        );
    }

    // Null covers both an unroutable pair and a token no native handler claims;
    // the browser bridge below is the one that can still answer either.
    const found = await findFirstPath(graph, handlers, inputMime, inputExt, outputMime, outputExt, true);
    if (!found) {
        const browserAvailable = await canConvertViaBrowser(inputMime, inputExt, outputMime, outputExt).catch(() => false);
        if (browserAvailable) {
            return Response.json({
                browserAssisted: true,
                message: "No native path found. Conversion is available via the browser bridge."
            });
        }
        return Response.json({ error: appendSupportContact(CONVERSION_NOT_AVAILABLE_TEXT) }, { status: 404 });
    }

    const path = found.map((p) => ({
        handler: p.handler.name,
        mime: p.format.mime,
        extension: p.format.extension,
        format: p.format.format
    }));

    return Response.json({ path });
}
