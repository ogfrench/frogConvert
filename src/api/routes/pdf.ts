import { writeFile } from "fs/promises";
import { join, basename } from "path";
import { z } from "zod";
import { merge } from "../../tools/pdfMerge.ts";
import { organize } from "../../tools/pdfOrganize.ts";
import { extract } from "../../tools/pdfExtract.ts";
import { watermark, hexToRgb, WATERMARK_DEFAULTS, WatermarkValidationError } from "../../tools/pdfWatermark.ts";
import type { CorePageEntry } from "../../tools/types.ts";
import type { FileData } from "../../core/FormatHandler/FormatHandler.ts";
import { resolveBytes, buildSourceFiles, stripExt, enforceSandboxedPath, ValidationError, type FileInputRef } from "../../mcp/core/fileInput.ts";
import { toUserErrorText, appendSupportContact, FEEDBACK_CONTACT_TEXT } from "../../components/utils/index.ts";

const watermarkBodySchema = z.object({
    text: z.string().min(1),
    fontSize: z.number().positive().default(WATERMARK_DEFAULTS.fontSize),
    colorHex: z.string().default(WATERMARK_DEFAULTS.colorHex),
    opacity: z.number().min(0).max(1).default(WATERMARK_DEFAULTS.opacity),
    rotationDegrees: z.number().default(WATERMARK_DEFAULTS.rotationDegrees),
    repeat: z.boolean().default(WATERMARK_DEFAULTS.repeat),
    pageNums: z.array(z.number().int().positive()).optional(),
    outputFilePath: z.string().optional(),
});

/** Format a zod issue list as "path: message" so existing error-string asserts (e.g. /repeat/) still match. */
function formatZodError(err: z.ZodError): string {
    return err.issues
        .map(i => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
        .join("; ");
}

/** Reject requests whose body isn't a plain JSON object. */
function assertObjectBody(body: unknown): asserts body is Record<string, unknown> {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new ValidationError("Request body must be a JSON object");
    }
}

/** Validate a FileInputRef shape before it reaches resolveBytes. */
function assertFileInputRef(value: unknown, label: string): asserts value is FileInputRef {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new ValidationError(`${label} must be an object`);
    }
    const v = value as Record<string, unknown>;
    if (v.filePath !== undefined && typeof v.filePath !== "string") {
        throw new ValidationError(`${label}.filePath must be a string`);
    }
    if (v.base64Bytes !== undefined && typeof v.base64Bytes !== "string") {
        throw new ValidationError(`${label}.base64Bytes must be a string`);
    }
    if (v.fileName !== undefined && typeof v.fileName !== "string") {
        throw new ValidationError(`${label}.fileName must be a string`);
    }
    if (!v.filePath && !v.base64Bytes) {
        throw new ValidationError(`${label} must have filePath or base64Bytes`);
    }
}

function filesResponse(files: FileData[]): Response {
    return Response.json({
        files: files.map(f => ({
            name: f.name,
            base64Bytes: Buffer.from(f.bytes).toString("base64"),
        })),
    });
}

export async function handlePdfMerge(req: Request): Promise<Response> {
    try {
        const raw = await req.json();
        assertObjectBody(raw);
        const body = raw as { inputs?: unknown; outputFilePath?: unknown };
        if (!Array.isArray(body.inputs) || body.inputs.length < 2) {
            return Response.json({ error: "inputs must be an array of at least 2 items" }, { status: 400 });
        }
        body.inputs.forEach((v, i) => assertFileInputRef(v, `inputs[${i}]`));
        if (body.outputFilePath !== undefined && typeof body.outputFilePath !== "string") {
            return Response.json({ error: "outputFilePath must be a string" }, { status: 400 });
        }
        const sourceFiles = await buildSourceFiles(body.inputs as FileInputRef[]);
        const result = await merge(sourceFiles);
        if (body.outputFilePath) {
            const safeOut = enforceSandboxedPath(body.outputFilePath);
            await writeFile(safeOut, result.bytes);
            return Response.json({ savedTo: [safeOut] });
        }
        return filesResponse([result]);
    } catch (err: any) {
        if (err instanceof ValidationError) {
            return Response.json({ error: err.message }, { status: 400 });
        }
        const msg = toUserErrorText(err) || (err?.message ?? String(err));
        return Response.json({ error: appendSupportContact(msg, FEEDBACK_CONTACT_TEXT) }, { status: 400 });
    }
}

interface PageEntryDTO {
    sourceIndex: number;
    pageNum: number;
    rotation?: 0 | 90 | 180 | 270;
    blank?: boolean;
    blankSize?: { width: number; height: number };
}

export async function handlePdfOrganize(req: Request): Promise<Response> {
    try {
        const raw = await req.json();
        assertObjectBody(raw);
        const body = raw as { inputs?: unknown; pages?: unknown; outputFilePath?: unknown };
        if (!Array.isArray(body.inputs) || body.inputs.length < 1) {
            return Response.json({ error: "inputs must be an array of at least 1 item" }, { status: 400 });
        }
        body.inputs.forEach((v, i) => assertFileInputRef(v, `inputs[${i}]`));
        if (!Array.isArray(body.pages) || body.pages.length < 1) {
            return Response.json({ error: "pages must be a non-empty array" }, { status: 400 });
        }
        body.pages.forEach((p, idx) => {
            if (!p || typeof p !== "object") {
                throw new ValidationError(`pages[${idx}] must be an object`);
            }
            const pp = p as Record<string, unknown>;
            if (typeof pp.sourceIndex !== "number") throw new ValidationError(`pages[${idx}].sourceIndex must be a number`);
            if (typeof pp.pageNum !== "number") throw new ValidationError(`pages[${idx}].pageNum must be a number`);
        });
        if (body.outputFilePath !== undefined && typeof body.outputFilePath !== "string") {
            return Response.json({ error: "outputFilePath must be a string" }, { status: 400 });
        }
        const inputs = body.inputs as FileInputRef[];
        const pages = body.pages as PageEntryDTO[];
        const sourceFiles = await buildSourceFiles(inputs);
        const manifest: CorePageEntry[] = pages.map((p, idx) => {
            const isBlank = p.blank || p.sourceIndex === -1;
            if (!isBlank && (p.sourceIndex < 0 || p.sourceIndex >= inputs.length)) {
                throw new ValidationError(`pages[${idx}].sourceIndex ${p.sourceIndex} out of range (inputs.length=${inputs.length})`);
            }
            return {
                type: isBlank ? "blank" : "source",
                sourceFileId: isBlank ? -1 : p.sourceIndex,
                sourcePageNum: isBlank ? 0 : p.pageNum,
                rotation: (p.rotation ?? 0) as 0 | 90 | 180 | 270,
                blankPageSize: p.blankSize,
            };
        });
        const result = await organize(sourceFiles, manifest);
        if (body.outputFilePath) {
            const safeOut = enforceSandboxedPath(body.outputFilePath as string);
            await writeFile(safeOut, result.bytes);
            return Response.json({ savedTo: [safeOut] });
        }
        return filesResponse([result]);
    } catch (err: any) {
        if (err instanceof ValidationError) {
            return Response.json({ error: err.message }, { status: 400 });
        }
        const msg = toUserErrorText(err) || (err?.message ?? String(err));
        return Response.json({ error: appendSupportContact(msg, FEEDBACK_CONTACT_TEXT) }, { status: 400 });
    }
}

export async function handlePdfExtract(req: Request): Promise<Response> {
    try {
        const raw = await req.json();
        assertObjectBody(raw);
        const body = raw as {
            input?: unknown;
            pageNums?: unknown;
            baseName?: unknown;
            groupAsOne?: unknown;
            outputDir?: unknown;
        };
        if (!body.input) return Response.json({ error: "input required" }, { status: 400 });
        assertFileInputRef(body.input, "input");
        if (!Array.isArray(body.pageNums) || body.pageNums.length < 1) {
            return Response.json({ error: "pageNums must be a non-empty array" }, { status: 400 });
        }
        if (!body.pageNums.every(n => typeof n === "number" && Number.isFinite(n))) {
            return Response.json({ error: "pageNums must contain only numbers" }, { status: 400 });
        }
        if (body.baseName !== undefined && typeof body.baseName !== "string") {
            return Response.json({ error: "baseName must be a string" }, { status: 400 });
        }
        if (body.groupAsOne !== undefined && typeof body.groupAsOne !== "boolean") {
            return Response.json({ error: "groupAsOne must be a boolean" }, { status: 400 });
        }
        if (body.outputDir !== undefined && typeof body.outputDir !== "string") {
            return Response.json({ error: "outputDir must be a string" }, { status: 400 });
        }
        const { bytes, name } = await resolveBytes(body.input as FileInputRef);
        const baseName = (body.baseName as string | undefined) ?? stripExt(name);
        const results = await extract(bytes, body.pageNums as number[], baseName, (body.groupAsOne as boolean | undefined) ?? false);

        if (body.outputDir) {
            const safeDir = enforceSandboxedPath(body.outputDir as string);
            const paths = await Promise.all(results.map(async f => {
                // basename() strips any path segments the extract tool may have
                // embedded in the output file name, keeping writes inside safeDir.
                const p = join(safeDir, basename(f.name));
                await writeFile(p, f.bytes);
                return p;
            }));
            return Response.json({ savedTo: paths });
        }
        return filesResponse(results);
    } catch (err: any) {
        if (err instanceof ValidationError) {
            return Response.json({ error: err.message }, { status: 400 });
        }
        const msg = toUserErrorText(err) || (err?.message ?? String(err));
        return Response.json({ error: appendSupportContact(msg, FEEDBACK_CONTACT_TEXT) }, { status: 400 });
    }
}

export async function handlePdfWatermark(req: Request): Promise<Response> {
    try {
        const raw = await req.json();
        assertObjectBody(raw);
        const body = raw as Record<string, unknown>;

        if (!body.input) return Response.json({ error: "input required" }, { status: 400 });
        assertFileInputRef(body.input, "input");

        const parsed = watermarkBodySchema.safeParse(body);
        if (!parsed.success) {
            return Response.json({ error: formatZodError(parsed.error) }, { status: 400 });
        }
        const { text, fontSize, colorHex, opacity, rotationDegrees, repeat, pageNums, outputFilePath } = parsed.data;

        let color;
        try {
            color = hexToRgb(colorHex);
        } catch (e: any) {
            return Response.json({ error: `colorHex: ${e.message}` }, { status: 400 });
        }

        const { bytes, name } = await resolveBytes(body.input as FileInputRef);

        const result = await watermark(bytes, name, {
            source: { type: "text", text, fontSize, color },
            opacity,
            rotationDegrees,
            repeat,
            pageNums,
        });

        if (outputFilePath !== undefined) {
            const safeOut = enforceSandboxedPath(outputFilePath);
            await writeFile(safeOut, result.bytes);
            return Response.json({ savedTo: [safeOut] });
        }
        return filesResponse([result]);
    } catch (err: any) {
        if (err instanceof ValidationError || err instanceof WatermarkValidationError) {
            return Response.json({ error: err.message }, { status: 400 });
        }
        const msg = toUserErrorText(err) || (err?.message ?? String(err));
        return Response.json({ error: appendSupportContact(msg, FEEDBACK_CONTACT_TEXT) }, { status: 400 });
    }
}
