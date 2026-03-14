import type { FormatHandler } from "../../core/FormatHandler/FormatHandler.ts";
import type { TraversionGraph } from "../../core/TraversionGraph/TraversionGraph.ts";
import { findFormatAndHandler } from "../../mcp/core/utils.ts";

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

    const inputMatch = findFormatAndHandler(handlers, inputMime, inputExt, 'from');
    const outputMatch = findFormatAndHandler(handlers, outputMime, outputExt, 'to');

    if (!inputMatch) {
        return Response.json({ error: `Input format ${inputMime} (${inputExt}) not found or not readable` }, { status: 404 });
    }
    if (!outputMatch) {
        return Response.json({ error: `Output format ${outputMime} (${outputExt}) not found or not writable` }, { status: 404 });
    }

    const pathsGenerator = graph.searchPath(
        { format: inputMatch.format, handler: inputMatch.handler },
        { format: outputMatch.format, handler: outputMatch.handler },
        false
    );

    const pathResult = await pathsGenerator.next();
    if (pathResult.done || !pathResult.value) {
        return Response.json({ error: `No conversion path found between ${inputMime} and ${outputMime}` }, { status: 404 });
    }

    const path = pathResult.value.map((p: any) => ({
        handler: p.handler.name,
        mime: p.format.mime,
        extension: p.format.extension,
        format: p.format.format
    }));

    return Response.json({ path });
}
