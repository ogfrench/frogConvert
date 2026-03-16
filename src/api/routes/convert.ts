import type { FormatHandler, FileData } from "../../core/FormatHandler/FormatHandler.ts";
import type { TraversionGraph } from "../../core/TraversionGraph/TraversionGraph.ts";
import { findFormatAndHandler } from "../../mcp/core/utils.ts";
import { convertViaBrowser } from "../../mcp/core/browserBridge.ts";
import mime from "mime";

async function runConversion(
    handlers: FormatHandler[],
    graph: TraversionGraph,
    fileName: string,
    bytes: Uint8Array,
    inputMime: string,
    inputExt: string,
    outputMime: string,
    outputExt: string
): Promise<{ files: FileData[]; error?: never } | { error: string; status: number }> {
    const inputMatch = findFormatAndHandler(handlers, inputMime, inputExt, 'from');
    const outputMatch = findFormatAndHandler(handlers, outputMime, outputExt, 'to');

    // Try native path when both formats are known to native handlers
    if (inputMatch && outputMatch) {
        const pathsGenerator = graph.searchPath(
            { format: inputMatch.format, handler: inputMatch.handler },
            { format: outputMatch.format, handler: outputMatch.handler },
            false
        );
        const pathResult = await pathsGenerator.next();
        if (!pathResult.done && pathResult.value) {
            const path = pathResult.value;
            let currentFiles: FileData[] = [{ name: fileName, bytes }];
            try {
                for (let i = 1; i < path.length; i++) {
                    const stepHandler = path[i].handler;
                    const prevFormat = path[i - 1].format;
                    const nextFormat = path[i].format;
                    currentFiles = await stepHandler.doConvert(currentFiles, prevFormat, nextFormat);
                }
                return { files: currentFiles };
            } catch {
                // Native execution failed — fall through to browser bridge
            }
        }
    }

    // No native path, format unknown to native registry, or native execution failed.
    // The bridge loads ALL handlers including browser-only ones (requiresMainThread=true).
    try {
        const b64 = Buffer.from(bytes).toString("base64");
        const bridgeResults = await convertViaBrowser(fileName, b64, inputMime, inputExt, outputMime, outputExt);
        const files: FileData[] = bridgeResults.map(r => ({
            name: r.fileName,
            bytes: new Uint8Array(Buffer.from(r.base64Bytes, "base64"))
        }));
        return { files };
    } catch (bridgeErr: any) {
        return { error: bridgeErr?.message ?? `No conversion path found between ${inputMime} and ${outputMime}`, status: 422 };
    }
}

export async function handleConvert(
    req: Request,
    handlers: FormatHandler[],
    graph: TraversionGraph
): Promise<Response> {
    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
        let formData: FormData;
        try {
            formData = await req.formData();
        } catch {
            return Response.json({ error: "Failed to parse multipart form data" }, { status: 400 });
        }

        const file = formData.get("file");
        const outputMime = formData.get("outputMime");
        const outputExt = formData.get("outputExt");

        if (!(file instanceof File)) {
            return Response.json({ error: "Missing 'file' field (must be a file upload)" }, { status: 400 });
        }
        if (typeof outputMime !== "string" || typeof outputExt !== "string") {
            return Response.json({ error: "Missing 'outputMime' or 'outputExt' fields" }, { status: 400 });
        }

        const fileName = file.name;
        const ext = fileName.includes(".") ? fileName.split(".").pop()! : "";
        const detectedMime = mime.getType(fileName) || "application/octet-stream";
        const bytes = new Uint8Array(await file.arrayBuffer());

        const result = await runConversion(handlers, graph, fileName, bytes, detectedMime, ext, outputMime, outputExt);
        if ("error" in result) {
            return Response.json({ error: result.error }, { status: result.status });
        }

        // Return the first file as a binary download; extra files returned as JSON attachment list
        const first = result.files[0];
        const outMime = mime.getType(first.name) || outputMime;
        return new Response(first.bytes, {
            headers: {
                "Content-Type": outMime,
                "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(first.name)}`,
                ...(result.files.length > 1
                    ? { "X-Extra-Files": JSON.stringify(result.files.slice(1).map(f => f.name)) }
                    : {})
            }
        });
    }

    if (contentType.includes("application/json")) {
        let body: any;
        try {
            body = await req.json();
        } catch {
            return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const { fileName, base64Bytes, inputMime, inputExt, outputMime, outputExt } = body;
        if (!fileName || !base64Bytes || !inputMime || !inputExt || !outputMime || !outputExt) {
            return Response.json(
                { error: "Body must include: fileName, base64Bytes, inputMime, inputExt, outputMime, outputExt" },
                { status: 400 }
            );
        }

        const buffer = Buffer.from(base64Bytes, "base64");
        const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

        const result = await runConversion(handlers, graph, fileName, bytes, inputMime, inputExt, outputMime, outputExt);
        if ("error" in result) {
            return Response.json({ error: result.error }, { status: result.status });
        }

        const output = result.files.map(f => ({
            fileName: f.name,
            base64Bytes: Buffer.from(f.bytes).toString("base64")
        }));
        return Response.json(output);
    }

    return Response.json(
        { error: "Content-Type must be 'multipart/form-data' or 'application/json'" },
        { status: 415 }
    );
}
