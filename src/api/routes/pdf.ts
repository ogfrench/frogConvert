import { writeFile } from "fs/promises";
import { join } from "path";
import { merge } from "../../tools/pdfMerge.ts";
import { organize } from "../../tools/pdfOrganize.ts";
import { extract } from "../../tools/pdfExtract.ts";
import type { CorePageEntry } from "../../tools/types.ts";
import type { FileData } from "../../core/FormatHandler/FormatHandler.ts";
import { resolveBytes, buildSourceFiles, stripExt, type FileInputRef } from "../../mcp/core/fileInput.ts";

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
        const body = await req.json() as { inputs: FileInputRef[]; outputFilePath?: string };
        if (!Array.isArray(body.inputs) || body.inputs.length < 2) {
            return Response.json({ error: "inputs must be an array of at least 2 items" }, { status: 400 });
        }
        const sourceFiles = await buildSourceFiles(body.inputs);
        const result = await merge(sourceFiles);
        if (body.outputFilePath) {
            await writeFile(body.outputFilePath, result.bytes);
            return Response.json({ savedTo: [body.outputFilePath] });
        }
        return filesResponse([result]);
    } catch (err: any) {
        return Response.json({ error: err?.message ?? String(err) }, { status: 400 });
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
        const body = await req.json() as { inputs: FileInputRef[]; pages: PageEntryDTO[]; outputFilePath?: string };
        if (!Array.isArray(body.inputs) || body.inputs.length < 1) {
            return Response.json({ error: "inputs must be an array of at least 1 item" }, { status: 400 });
        }
        if (!Array.isArray(body.pages) || body.pages.length < 1) {
            return Response.json({ error: "pages must be a non-empty array" }, { status: 400 });
        }
        const sourceFiles = await buildSourceFiles(body.inputs);
        const manifest: CorePageEntry[] = body.pages.map((p, idx) => {
            const isBlank = p.blank || p.sourceIndex === -1;
            if (!isBlank && (p.sourceIndex < 0 || p.sourceIndex >= body.inputs.length)) {
                throw new Error(`pages[${idx}].sourceIndex ${p.sourceIndex} out of range (inputs.length=${body.inputs.length})`);
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
            await writeFile(body.outputFilePath, result.bytes);
            return Response.json({ savedTo: [body.outputFilePath] });
        }
        return filesResponse([result]);
    } catch (err: any) {
        return Response.json({ error: err?.message ?? String(err) }, { status: 400 });
    }
}

export async function handlePdfExtract(req: Request): Promise<Response> {
    try {
        const body = await req.json() as {
            input: FileInputRef;
            pageNums: number[];
            baseName?: string;
            groupAsOne?: boolean;
            outputDir?: string;
        };
        if (!body.input) return Response.json({ error: "input required" }, { status: 400 });
        if (!Array.isArray(body.pageNums) || body.pageNums.length < 1) {
            return Response.json({ error: "pageNums must be a non-empty array" }, { status: 400 });
        }
        const { bytes, name } = await resolveBytes(body.input);
        const baseName = body.baseName ?? stripExt(name);
        const results = await extract(bytes, body.pageNums, baseName, body.groupAsOne ?? false);

        if (body.outputDir) {
            const paths = await Promise.all(results.map(async f => {
                const p = join(body.outputDir!, f.name);
                await writeFile(p, f.bytes);
                return p;
            }));
            return Response.json({ savedTo: paths });
        }
        return filesResponse(results);
    } catch (err: any) {
        return Response.json({ error: err?.message ?? String(err) }, { status: 400 });
    }
}
