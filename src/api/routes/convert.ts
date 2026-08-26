import { hopQualityArgs } from "../../core/compression/hopQuality.ts";
import type { FormatHandler, FileData, QualityPreset } from "../../core/FormatHandler/FormatHandler.ts";
import type { TraversionGraph } from "../../core/TraversionGraph/TraversionGraph.ts";
import { findFirstPath, libreofficeHint } from "../../mcp/core/utils.ts";
import { convertViaBrowser } from "../../mcp/core/browserBridge.ts";
import { resolveEffectiveQuality } from "../../core/compression/resolveEffectiveQuality.ts";
import { appendSupportContact, toUserErrorInfo } from "../../components/utils/index.ts";
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
): Promise<{ files: FileData[]; error?: never } | { error: string; status: number }> {
    const resolved = await resolveEffectiveQuality(quality, bytes, inputMime, outputMime);
    if (resolved === null) {
        // Already-minimal: return the input unchanged.
        return { files: [{ name: fileName, bytes }] };
    }
    const effectiveQuality: QualityPreset = resolved;
    let nativeFailure: unknown = null;

    // Try native first. findFirstPath resolves both tokens and searches, trying
    // the next reading of an ambiguous one rather than giving up on the first.
    // simpleMode=true: accept any handler for the final step. Without it the
    // resolver can name e.g. ImageMagick for PDF output while libreoffice
    // provides the actual pptx→pdf edge, and the handler-name constraint would
    // reject the libreoffice path, costing a 15s timeout searching for a
    // non-existent ImageMagick-terminated one.
    const path = await findFirstPath(graph, handlers, inputMime, inputExt, outputMime, outputExt, true);
    if (path) {
        let currentFiles: FileData[] = [{ name: fileName, bytes }];
        try {
            for (let i = 1; i < path.length; i++) {
                const stepHandler = path[i].handler;
                const prevFormat = path[i - 1].format;
                const nextFormat = path[i].format;
                currentFiles = await stepHandler.doConvert(currentFiles, prevFormat, nextFormat,
                            hopQualityArgs({ target: nextFormat, isLastHop: i === path.length - 1, requested: effectiveQuality }));
            }
            return { files: currentFiles };
        } catch (nativeErr) {
            nativeFailure = nativeErr;
            // Native execution failed, fall through to browser bridge
        }
    }

    // No native path, format unknown to native registry, or native execution failed.
    // The bridge loads ALL handlers including browser-only ones (requiresMainThread=true).
    try {
        const b64 = Buffer.from(bytes).toString("base64");
        const bridgeResults = await convertViaBrowser(fileName, b64, inputMime, inputExt, outputMime, outputExt, effectiveQuality);
        const files: FileData[] = bridgeResults.map(r => ({
            name: r.fileName,
            bytes: new Uint8Array(Buffer.from(r.base64Bytes, "base64"))
        }));
        return { files };
    } catch (bridgeErr: any) {
        const bridgeInfo = toUserErrorInfo(bridgeErr);
        const nativeInfo = nativeFailure ? toUserErrorInfo(nativeFailure) : null;
        let msg = nativeInfo?.kind === "unknown" || nativeInfo?.kind === "runtime_failure"
            ? "Something went wrong while converting this file."
            : bridgeInfo.message || "Something went wrong while converting this file.";
        const hint = allHandlers && libreofficeHint(allHandlers, inputExt, outputExt);
        if (hint) msg += ` ${hint}`;
        return { error: appendSupportContact(msg), status: 422 };
    }
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
