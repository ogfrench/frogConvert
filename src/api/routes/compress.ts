import type { FormatHandler, QualityPreset } from "../../core/FormatHandler/FormatHandler.ts";
import { compressForAgents, type AgentCompressInput } from "../../core/compression/compressForAgents.ts";
import { compressInBrowser } from "../compressInBrowser.ts";
import mime from "mime";

/**
 * `POST /compress` - make a file smaller without changing what it is.
 *
 * ## Why this is not `POST /convert` with the same format twice
 *
 * That was the documented approach and it never worked. A same-format request
 * resolves to a **zero-hop path** through the conversion graph, and the runner
 * is `for (let i = 1; i < path.length; i++)` - so it executes no steps and
 * returns the input untouched. Measured before this endpoint existed: a 10 MB
 * image-heavy PDF came back byte-identical at every quality preset, while the
 * browser shrank the same file by 89%.
 *
 * Compression is a different question from conversion - "same thing, fewer
 * bytes" rather than "different thing" - and it needs its own engine
 * selection, its own keep-threshold and its own vocabulary for "I could not
 * help with this one". The web UI reached the same conclusion when it grew a
 * separate Compress surface; this is that surface's API.
 *
 * ## Shape
 *
 * Multipart (`file`, optional `level`) or JSON (`fileName`, `base64Bytes`,
 * optional `level`). Multipart returns the bytes as a download with the report
 * in headers; JSON returns the report with base64 bytes, because a script that
 * posted JSON wants to read the outcome, not save a file.
 *
 * `level` is `auto` (default, matches the web UI), `high`, `medium` or `low`.
 * There is deliberately no `lossless`: as a compression level it can only mean
 * "do nothing".
 */

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 4096);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/** Compression levels, minus `lossless` - see the note above. */
function parseLevel(raw: unknown): QualityPreset | "auto" | null {
    if (raw === undefined || raw === null || raw === "") return "auto";
    if (raw === "auto" || raw === "low" || raw === "medium" || raw === "high") return raw;
    return null;
}

const LEVEL_ERROR = "Invalid 'level'. Use 'auto', 'high', 'medium' or 'low'.";

/**
 * A caller needs to know not just the bytes but whether anything happened, and
 * if not, why. `reason` uses the same vocabulary the UI shows.
 */
function reportFor(r: Awaited<ReturnType<typeof compressForAgents>>[number]) {
    const saved = r.originalSize - r.bytes.byteLength;
    return {
        name: r.name,
        originalSize: r.originalSize,
        compressedSize: r.bytes.byteLength,
        savedBytes: saved,
        savedPercent: r.originalSize > 0 ? Number(((saved / r.originalSize) * 100).toFixed(1)) : 0,
        shrunk: r.shrunk,
        ...(r.reason ? { reason: r.reason } : {}),
        ...(r.warning ? { warning: r.warning } : {}),
    };
}

export async function handleCompress(
    req: Request,
    handlers: FormatHandler[],
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

        const file = asUpload(formData.get("file"));
        const level = parseLevel(formData.get("level") ?? undefined);
        if (!file) {
            return Response.json({ error: "Missing 'file' field (must be a file upload)" }, { status: 400 });
        }
        if (level === null) return Response.json({ error: LEVEL_ERROR }, { status: 400 });
        if (file.size > MAX_UPLOAD_BYTES) {
            return Response.json({ error: `File too large (max ${MAX_UPLOAD_MB} MB)` }, { status: 413 });
        }

        const input = toInput(file.name, new Uint8Array(await file.arrayBuffer()));
        const [result] = await compressForAgents([input], { handlers, level, browserFallback: compressInBrowser });
        const report = reportFor(result);

        // The bytes are the payload; the report rides in a header so a caller
        // that only wanted a smaller file can ignore it, and one that needs to
        // know whether it shrank does not have to weigh the response itself.
        return new Response(result.bytes as unknown as BodyInit, {
            headers: {
                "Content-Type": mime.getType(result.name) || "application/octet-stream",
                "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.name)}`,
                "X-Compress-Report": JSON.stringify(report),
            },
        });
    }

    if (contentType.includes("application/json")) {
        let body: any;
        try {
            body = await req.json();
        } catch {
            return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const level = parseLevel(body.level);
        if (level === null) return Response.json({ error: LEVEL_ERROR }, { status: 400 });

        // One file or many: a batch is the case the UI is built around, and a
        // script compressing a folder should not have to make N requests.
        const rawFiles: unknown[] = Array.isArray(body.files)
            ? body.files
            : (body.fileName && body.base64Bytes ? [{ fileName: body.fileName, base64Bytes: body.base64Bytes }] : []);
        if (!rawFiles.length) {
            return Response.json(
                { error: "Body must include either 'fileName' and 'base64Bytes', or a 'files' array of them" },
                { status: 400 },
            );
        }

        const inputs: AgentCompressInput[] = [];
        let total = 0;
        for (const raw of rawFiles as Array<{ fileName?: string; base64Bytes?: string }>) {
            if (!raw?.fileName || typeof raw.base64Bytes !== "string") {
                return Response.json({ error: "Each file needs 'fileName' and 'base64Bytes'" }, { status: 400 });
            }
            const bytes = new Uint8Array(Buffer.from(raw.base64Bytes, "base64"));
            total += bytes.byteLength;
            if (total > MAX_UPLOAD_BYTES) {
                return Response.json({ error: `Payload too large (max ${MAX_UPLOAD_MB} MB)` }, { status: 413 });
            }
            inputs.push(toInput(raw.fileName, bytes));
        }

        const results = await compressForAgents(inputs, { handlers, level, browserFallback: compressInBrowser });
        return Response.json({
            level,
            files: results.map(r => ({
                ...reportFor(r),
                base64Bytes: Buffer.from(r.bytes).toString("base64"),
            })),
        });
    }

    return Response.json(
        { error: "Content-Type must be multipart/form-data or application/json" },
        { status: 415 },
    );
}

/**
 * A form value that is a file, without `instanceof File`.
 *
 * `instanceof` compares against *this* realm's constructor, and the `File` a
 * multipart body is parsed into does not always come from it - Bun, undici and
 * jsdom each bring their own. What is actually required is a name and a way to
 * get the bytes, so that is what is checked. The realm the object came from is
 * not information worth acting on.
 */
function asUpload(value: unknown): { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> } | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as { name?: unknown; size?: unknown; arrayBuffer?: unknown };
    if (typeof candidate.arrayBuffer !== "function") return null;
    if (typeof candidate.name !== "string" || !candidate.name) return null;
    return value as { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> };
}

/** Derive the format from the filename, the same way the upload path does. */
function toInput(fileName: string, bytes: Uint8Array): AgentCompressInput {
    const extension = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
    return {
        name: fileName,
        bytes,
        mime: mime.getType(fileName) || "application/octet-stream",
        extension,
    };
}
