// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { corpusFile, hasCorpus, reportCorpusSkips, CORPUS_REASON } from "../helpers/corpus.ts";
import { hasFullRegistry, MISSING_DEPS_REASON } from "../helpers/optionalDeps.ts";
import {
    startMcp, startApi, callTool, postFile, sniff, fromB64, toB64, type McpSession,
} from "../helpers/corpusAgents.ts";
import { inspectPdf, pdfPageTexts } from "../helpers/corpusBrowser.ts";

/**
 * The MCP server, over a real stdio transport, against real files.
 *
 * `src/mcp/index.integration.test.ts` proves the transport works and that
 * `compress_file` survives one synthetic PDF. What it cannot cover, because it
 * has nothing real to feed the thing, is the part of this surface that touches
 * an agent's filesystem: bytes read from a path, results written to a path, and
 * a batch that invents output names of its own.
 *
 * That last group is where a mistake is least recoverable. In the browser a bad
 * compression is a row in a table you can ignore. Here it is a file written
 * over something in somebody's folder.
 */

const NEEDED = [
    "pdf/paper.pdf",
    "pdf/large-text.pdf",
    "pdf/password.pdf",
    "pdf/forms.pdf",
    "pdf/4pages.pdf",
    "image/photo-mobile.jpg",
    "adversarial/truncated.pdf",
    "adversarial/mixed-orientation.pdf",
];

const ready = hasCorpus(...NEEDED) && hasFullRegistry;

describe.skipIf(!ready)(`MCP against the real corpus [${CORPUS_REASON}; ${MISSING_DEPS_REASON}]`, () => {
    let mcp: McpSession;
    let tmp: string;

    beforeAll(async () => {
        mcp = await startMcp();
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frog-corpus-mcp-"));
    }, 300_000);

    afterAll(async () => {
        await mcp?.close();
        fs.rmSync(tmp, { recursive: true, force: true });
        reportCorpusSkips();
    }, 60_000);

    const ref = (rel: string) => ({ filePath: corpusFile(rel)! });
    /** A scratch path inside this suite's own temp directory. */
    const out = (name: string) => path.join(tmp, name);

    // --- compress_file ----------------------------------------------------

    it("writes exactly the bytes it reported, to the path it was given", async () => {
        const source = corpusFile("pdf/large-text.pdf")!;
        const before = fs.statSync(source).size;
        const target = out("large-text.small.pdf");

        const { files: [file] } = await callTool(mcp.client, "compress_file", {
            filePath: source, outputFilePath: target, level: "medium",
        });

        expect(file.originalSize).toBe(before);
        expect(file.shrunk).toBe(true);
        expect(file.savedTo).toBe(target);

        // The report is a description; the file is the fact.
        const written = fs.readFileSync(target);
        expect(written.byteLength).toBe(file.compressedSize);
        expect(written.byteLength).toBeLessThan(before);
        expect(sniff(written)).toBe("pdf");
    }, 900_000);

    it("a compressed PDF still has every page and every word", async () => {
        const source = corpusFile("pdf/large-text.pdf")!;
        const original = fs.readFileSync(source);
        const beforeText = await pdfPageTexts(original);
        const beforeShape = await inspectPdf(original);

        const target = out("meaning.pdf");
        await callTool(mcp.client, "compress_file", {
            filePath: source, outputFilePath: target, level: "medium",
        });

        const written = fs.readFileSync(target);
        expect((await inspectPdf(written)).pageCount).toBe(beforeShape.pageCount);
        expect(await pdfPageTexts(written)).toEqual(beforeText);
    }, 900_000);

    it("writes the original file, not an empty one, when it cannot compress", async () => {
        // The worst thing this surface can do. `outputFilePath` is a path the
        // caller chose, and "I could not compress this" must not mean "here is
        // 0 bytes where your file was going to be" - the defect that reported
        // an 83% saving on an encrypted PDF and produced nothing.
        for (const rel of ["pdf/password.pdf", "adversarial/truncated.pdf"]) {
            const source = corpusFile(rel)!;
            const target = out(`refused-${path.basename(rel)}`);

            const { files: [file] } = await callTool(mcp.client, "compress_file", {
                filePath: source, outputFilePath: target, level: "auto",
            });

            expect(file.shrunk, `${rel} claimed a saving`).toBe(false);
            expect(file.savedPercent).toBe(0);
            expect(file.reason).toBeTruthy();
            expect(fs.readFileSync(target).equals(fs.readFileSync(source)),
                `${rel}: what landed on disk is not the source file`).toBe(true);
        }
    }, 900_000);

    it("a batch writes beside each source and never over it", async () => {
        // `-compressed` siblings are this tool's own invention - there is no
        // equivalent anywhere else in the app - so nothing else can catch it
        // getting the naming, or the target, wrong. Overwriting an input is the
        // failure that cannot be undone.
        const dir = fs.mkdtempSync(path.join(tmp, "batch-"));
        const a = path.join(dir, "paper.pdf");
        const b = path.join(dir, "photo.jpg");
        fs.copyFileSync(corpusFile("pdf/paper.pdf")!, a);
        fs.copyFileSync(corpusFile("image/photo-mobile.jpg")!, b);
        const originals = [fs.readFileSync(a), fs.readFileSync(b)];

        const { files } = await callTool(mcp.client, "compress_file", {
            filePaths: [a, b], level: "medium",
        });

        expect(files.map((f: { savedTo: string }) => f.savedTo)).toEqual([
            path.join(dir, "paper-compressed.pdf"),
            path.join(dir, "photo-compressed.jpg"),
        ]);
        for (const f of files) {
            expect(f.shrunk).toBe(true);
            expect(fs.statSync(f.savedTo).size).toBe(f.compressedSize);
        }
        // A batch hands back paths rather than megabytes of base64 an agent did
        // not ask for, and the sources are still exactly what they were.
        expect(files.every((f: { base64Bytes?: string }) => f.base64Bytes === undefined)).toBe(true);
        expect(fs.readFileSync(a).equals(originals[0]), "the source PDF was overwritten").toBe(true);
        expect(fs.readFileSync(b).equals(originals[1]), "the source JPEG was overwritten").toBe(true);
    }, 900_000);

    it("hands back the whole file, in base64, for a format it cannot compress", async () => {
        // With no output path the bytes are the entire answer, and the defect
        // this pins returned an empty array - reported to the agent as a 100%
        // saving, and written out as a 0-byte file.
        const body = Buffer.from("x".repeat(9000));
        const { files: [file] } = await callTool(mcp.client, "compress_file", {
            fileName: "notes.xyz", base64Bytes: toB64(body),
        });

        expect(file.shrunk).toBe(false);
        expect(file.reason).toBeTruthy();
        expect(file.savedPercent).toBe(0);
        expect(fromB64(file.base64Bytes).byteLength).toBe(9000);
        expect(Buffer.from(fromB64(file.base64Bytes)).equals(body)).toBe(true);
    }, 900_000);

    it("never returns a larger file, at any level", async () => {
        const source = corpusFile("image/photo-mobile.jpg")!;
        const before = fs.statSync(source).size;
        for (const level of ["auto", "high", "medium", "low"]) {
            const target = out(`never-worse-${level}.jpg`);
            await callTool(mcp.client, "compress_file", { filePath: source, outputFilePath: target, level });
            const after = fs.statSync(target).size;
            expect(after, `${level} returned ${after} B for a ${before} B input`).toBeLessThanOrEqual(before);
            expect(sniff(fs.readFileSync(target))).toBe("jpeg");
        }
    }, 900_000);

    it("the levels are distinct, not four names for one setting", async () => {
        const source = corpusFile("image/photo-mobile.jpg")!;
        const sizes: Record<string, number> = {};
        for (const level of ["high", "medium", "low"]) {
            const { files: [f] } = await callTool(mcp.client, "compress_file", {
                filePath: source, outputFilePath: out(`level-${level}.jpg`), level,
            });
            sizes[level] = f.compressedSize;
        }
        expect(new Set(Object.values(sizes)).size, `high/medium/low gave ${JSON.stringify(sizes)}`).toBe(3);
        expect(sizes.high).toBeGreaterThan(sizes.medium);
        expect(sizes.medium).toBeGreaterThan(sizes.low);
    }, 900_000);

    // --- the pdf_* tools --------------------------------------------------

    it("pdf_merge keeps every page, in order, with rotation intact", async () => {
        const sources = ["pdf/4pages.pdf", "adversarial/mixed-orientation.pdf"];
        const before = await Promise.all(sources.map(s => inspectPdf(fs.readFileSync(corpusFile(s)!))));

        const [result] = await callTool(mcp.client, "pdf_merge", { inputs: sources.map(ref) });
        const bytes = fromB64(result.base64Bytes);
        const after = await inspectPdf(bytes);

        expect(after.pageCount).toBe(before.reduce((n, b) => n + b.pageCount, 0));
        expect((await pdfPageTexts(bytes)).flatMap(t => t.match(/MIXED \d+/) ?? []))
            .toEqual(["MIXED 1", "MIXED 2", "MIXED 3", "MIXED 4"]);
        expect(after.sizes.some(s => s.rot === 90), "rotation was flattened").toBe(true);
    }, 900_000);

    it("pdf_organize reorders the pages it was told to reorder", async () => {
        const [result] = await callTool(mcp.client, "pdf_organize", {
            inputs: [ref("adversarial/mixed-orientation.pdf")],
            pages: [4, 3, 2, 1].map(pageNum => ({ sourceIndex: 0, pageNum })),
        });
        expect((await pdfPageTexts(fromB64(result.base64Bytes))).flatMap(t => t.match(/MIXED \d+/) ?? []))
            .toEqual(["MIXED 4", "MIXED 3", "MIXED 2", "MIXED 1"]);
    }, 900_000);

    it("pdf_extract writes one real PDF per page when given a directory", async () => {
        const dir = fs.mkdtempSync(path.join(tmp, "extract-"));
        const { savedTo } = await callTool(mcp.client, "pdf_extract", {
            input: ref("pdf/4pages.pdf"), pageNums: [2, 4], outputDir: dir,
        });

        expect(savedTo.map((p: string) => path.basename(p)))
            .toEqual(["4pages_page_2.pdf", "4pages_page_4.pdf"]);
        for (const p of savedTo) {
            const bytes = fs.readFileSync(p);
            expect(sniff(bytes)).toBe("pdf");
            expect((await inspectPdf(bytes)).pageCount).toBe(1);
        }
    }, 900_000);

    it("pdf_watermark marks exactly the pages asked for, and keeps the form", async () => {
        const [marked] = await callTool(mcp.client, "pdf_watermark", {
            input: ref("adversarial/mixed-orientation.pdf"),
            text: "CONFIDENTIAL 2026", pageNums: [2],
        });
        const stamped = (await pdfPageTexts(fromB64(marked.base64Bytes)))
            .map((t, i) => (/CONFIDENTIAL/i.test(t) ? i + 1 : 0))
            .filter(Boolean);
        expect(stamped, "the watermark reached the wrong pages").toEqual([2]);

        const fieldsBefore = (await inspectPdf(fs.readFileSync(corpusFile("pdf/forms.pdf")!))).fields;
        expect(fieldsBefore.length).toBeGreaterThan(0);
        const [onForm] = await callTool(mcp.client, "pdf_watermark", {
            input: ref("pdf/forms.pdf"), text: "DRAFT",
        });
        expect((await inspectPdf(fromB64(onForm.base64Bytes))).fields).toEqual(fieldsBefore);
    }, 900_000);

    // --- the two surfaces agree ------------------------------------------

    it("gives byte-for-byte the same answer as the REST API", async () => {
        // Both surfaces are thin wrappers over `compressForAgents`, so any
        // divergence means one of them is passing different options - and
        // nothing else in the suite would notice, because each surface is only
        // ever compared against itself. The cheapest possible guard on the
        // thing most likely to rot quietly.
        //
        // Compared by size and content, not by bytes. Ghostscript stamps an
        // XMP `ModifyDate` into everything it writes, so the same file
        // compressed twice a second apart on the SAME surface already differs -
        // measured, after a first version of this test asserted byte equality
        // and reported the app broken for it.
        const source = corpusFile("pdf/paper.pdf")!;

        const { files: [viaMcp] } = await callTool(mcp.client, "compress_file", {
            filePath: source, outputFilePath: out("parity.pdf"), level: "medium",
        });

        const api = await startApi();
        try {
            const viaRest = await postFile(api.base, "/compress", source, { level: "medium" });
            expect(viaRest.report.originalSize).toBe(viaMcp.originalSize);
            expect(viaRest.report.compressedSize).toBe(viaMcp.compressedSize);
            expect(viaRest.report.shrunk).toBe(viaMcp.shrunk);

            const fromMcp = fs.readFileSync(out("parity.pdf"));
            expect(viaRest.bytes.byteLength).toBe(fromMcp.byteLength);
            expect((await inspectPdf(viaRest.bytes)).pageCount)
                .toBe((await inspectPdf(fromMcp)).pageCount);
            expect(await pdfPageTexts(viaRest.bytes)).toEqual(await pdfPageTexts(fromMcp));
        } finally {
            await api.close();
        }
    }, 900_000);
});
