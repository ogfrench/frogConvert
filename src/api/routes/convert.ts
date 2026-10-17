import type { FormatHandler, QualityPreset } from "../../core/FormatHandler/FormatHandler.ts";
import type { TraversionGraph } from "../../core/TraversionGraph/TraversionGraph.ts";
import { convertForAgents } from "../../mcp/core/convert.ts";
import mime from "mime";

function parseQuality(raw: unknown): QualityPreset | undefined {
    if (raw === "low" || raw === "medium" || raw === "high" || raw === "lossless") return raw;
    return undefined;
}

async function runConversion(
    handlers: FormatHandler[],
    graph: TraversionGraph,
    fileName: string,
    bytes: Uint8Array,
    inputMime: string,
    inputExt: string,
    outputMime: string,
    outputExt: string,
    quality?: QualityPreset,
    allHandlers?: FormatHandler[]
) {
    // Shared with MCP convert_file, so the two surfaces cannot drift again.
    return convertForAgents({ handlers, graph, allHandlers, fileName, bytes, inputMime, inputExt, outputMime, outputExt, quality });
}

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 4096);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export async function handleConvert(
    req: Request,
    handlers: FormatHandler[],
    graph: TraversionGraph,
    allHandlers?: FormatHandler[]
): Promise<Response> {
    const contentLength = Number(req.headers.get("content-length") ?? 0);
    if (contentLength > MAX_UPLOAD_BYTES) {
        return Response.json({ error: `Payload too large (max ${MAX_UPLOAD_MB} MB)` }, { status: 413 });
    }

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
        const quality = parseQuality(formData.get("quality"));

        if (!(file instanceof File)) {
            return Response.json({ error: "Missing 'file' field (must be a file upload)" }, { status: 400 });
        }
        if (typeof outputMime !== "string" || typeof outputExt !== "string") {
            return Response.json({ error: "Missing 'outputMime' or 'outputExt' fields" }, { status: 400 });
        }

        if (file.size > MAX_UPLOAD_BYTES) {
            return Response.json({ error: `File too large (max ${MAX_UPLOAD_MB} MB)` }, { status: 413 });
        }

        const fileName = file.name;
        const ext = fileName.includes(".") ? fileName.split(".").pop()! : "";
        const detectedMime = mime.getType(fileName) || "application/octet-stream";
        const bytes = new Uint8Array(await file.arrayBuffer());

        const result = await runConversion(handlers, graph, fileName, bytes, detectedMime, ext, outputMime, outputExt, quality, allHandlers);
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
                    : {}),
                // A binary body has no room for them, so the warnings ride in a
                // header (e.g. that a PDF is made of pictures).
                ...(result.warnings.length > 0
                    ? { "X-Warnings": encodeURIComponent(JSON.stringify(result.warnings)) }
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

        const { fileName, base64Bytes, inputMime, inputExt, outputMime, outputExt, quality: qualityRaw } = body;
        if (!fileName || !base64Bytes || !inputMime || !inputExt || !outputMime || !outputExt) {
            return Response.json(
                { error: "Body must include: fileName, base64Bytes, inputMime, inputExt, outputMime, outputExt" },
                { status: 400 }
            );
        }

        if (typeof base64Bytes === "string" && base64Bytes.length * 0.75 > MAX_UPLOAD_BYTES) {
            return Response.json({ error: `File too large (max ${MAX_UPLOAD_MB} MB)` }, { status: 413 });
        }

        const buffer = Buffer.from(base64Bytes, "base64");
        const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const quality = parseQuality(qualityRaw);

        const result = await runConversion(handlers, graph, fileName, bytes, inputMime, inputExt, outputMime, outputExt, quality, allHandlers);
        if ("error" in result) {
            return Response.json({ error: result.error }, { status: result.status });
        }

        // Warnings were dropped here while MCP returned them, so an agent on
        // REST was told nothing when a PDF came out as pictures.
        const output = result.files.map(f => ({
            fileName: f.name,
            base64Bytes: Buffer.from(f.bytes).toString("base64"),
            ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
        }));
        return Response.json(output);
    }

    return Response.json(
        { error: "Content-Type must be 'multipart/form-data' or 'application/json'" },
        { status: 415 }
    );
}
