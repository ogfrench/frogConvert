// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { corpusFile, hasCorpus, reportCorpusSkips, CORPUS_REASON } from "../helpers/corpus.ts";
import { hasFullRegistry, MISSING_DEPS_REASON } from "../helpers/optionalDeps.ts";
import {
    startApi, postJson, postFile, sniff, toB64, fromB64, type ApiServer,
} from "../helpers/corpusAgents.ts";
import { inspectPdf, pdfPageTexts } from "../helpers/corpusBrowser.ts";

/**
 * The local REST API, driven over real HTTP, against real files.
 *
 * `src/api/routes/*.route.test.ts` already pins the shape of each route, and
 * does it against fake handlers and `new Uint8Array(4000)` - deliberately, so
 * those tests stay fast and deterministic. Nothing until now has put an actual
 * document through an actual server.
 *
 * That matters because this surface owns seams the browser does not have:
 * bytes read off disk, base64 in both directions, and a server process
 * launching Chromium for anything it cannot answer natively. It also owns the
 * consequences of getting "I could not compress this" wrong - in the browser
 * that is a row in a table, over a socket it is a zero-byte download.
 */

const NEEDED = [
    "pdf/paper.pdf",
    "pdf/large-text.pdf",
    "pdf/password.pdf",
    "pdf/forms.pdf",
    "pdf/4pages.pdf",
    "image/photo-mobile.jpg",
    "ps/tiger.eps",
    "adversarial/truncated.pdf",
    "adversarial/zero.pdf",
    "adversarial/mixed-orientation.pdf",
];

const ready = hasCorpus(...NEEDED) && hasFullRegistry;

/** A sentence from paper.pdf, used to prove text survived rather than counting it. */
const PAPER_PHRASE = "Our implementation does not extend at all side exits";

describe.skipIf(!ready)(`REST API against the real corpus [${CORPUS_REASON}; ${MISSING_DEPS_REASON}]`, () => {
    let api: ApiServer;

    beforeAll(async () => {
        api = await startApi();
    }, 300_000);

    afterAll(async () => {
        await api?.close();
        reportCorpusSkips();
    }, 60_000);

    /** A `filePath` reference, which is how an agent addresses a local file. */
    const ref = (rel: string) => ({ filePath: corpusFile(rel)! });

    // --- compress ---------------------------------------------------------

    it("the report describes the bytes it actually sent", async () => {
        // The claim-versus-payload check. Its browser equivalent caught
        // "Compressed at Smallest file" printed above a file 126 bytes larger
        // than the input; here the same class of error is worse, because the
        // caller has no modal to read and the header is all they get.
        const source = corpusFile("pdf/large-text.pdf")!;
        const before = fs.statSync(source).size;
        const res = await postFile(api.base, "/compress", source, { level: "medium" });

        expect(res.status).toBe(200);
        expect(res.report, "no X-Compress-Report header").not.toBeNull();
        expect(res.report.originalSize).toBe(before);
        expect(res.report.compressedSize).toBe(res.bytes.byteLength);
        expect(res.report.savedBytes).toBe(before - res.bytes.byteLength);
        expect(res.report.shrunk).toBe(true);
        expect(res.bytes.byteLength).toBeLessThan(before);
        expect(sniff(res.bytes)).toBe("pdf");
    }, 600_000);

    it("a compressed PDF still has every page and every word", async () => {
        // The one that separates a good number from data loss: a PDF that
        // shrinks by rasterising its text passes every size-based check there
        // is and has destroyed the document. Measured on this file, extraction
        // before and after is character-for-character identical.
        const source = corpusFile("pdf/large-text.pdf")!;
        const original = fs.readFileSync(source);
        const beforeText = await pdfPageTexts(original);
        const beforeShape = await inspectPdf(original);

        const res = await postFile(api.base, "/compress", source, { level: "medium" });
        const afterShape = await inspectPdf(res.bytes);

        expect(afterShape.pageCount).toBe(beforeShape.pageCount);
        expect(await pdfPageTexts(res.bytes)).toEqual(beforeText);
    }, 600_000);

    it("does not rasterise a text-and-vector PDF at any level", async () => {
        // paper.pdf is the never-worse case from the other direction: a
        // typeset document with almost nothing to squeeze. Ghostscript
        // re-emits its fonts, so extraction drifts by a handful of characters
        // out of 83,000 - which is why this asserts the text did not COLLAPSE
        // rather than that it is identical. Rasterisation takes that count to
        // roughly zero, and no amount of font subsetting looks like that.
        const source = corpusFile("pdf/paper.pdf")!;
        const original = fs.readFileSync(source);
        const beforeText = (await pdfPageTexts(original)).join(" ");
        expect(beforeText, "corpus drift: paper.pdf no longer contains the sampled phrase")
            .toContain(PAPER_PHRASE);
        const beforePages = (await inspectPdf(original)).pageCount;

        for (const level of ["auto", "high", "medium", "low"]) {
            const res = await postFile(api.base, "/compress", source, { level });
            const afterText = (await pdfPageTexts(res.bytes)).join(" ");

            expect((await inspectPdf(res.bytes)).pageCount, `${level} changed the page count`)
                .toBe(beforePages);
            expect(afterText, `${level} lost the sampled sentence`).toContain(PAPER_PHRASE);
            expect(
                Math.abs(afterText.length - beforeText.length) / beforeText.length,
                `${level}: extracted text went from ${beforeText.length} to ${afterText.length} characters`,
            ).toBeLessThan(0.01);
        }
    }, 900_000);

    it("refuses an encrypted PDF and hands back the file, not an empty body", async () => {
        // The defect this replaces reported an 83% saving on a
        // password-protected PDF and returned a document with nothing in it.
        // Over HTTP the bytes ARE the response, so there is no second chance
        // to notice.
        const source = corpusFile("pdf/password.pdf")!;
        const before = fs.readFileSync(source);
        const res = await postFile(api.base, "/compress", source, { level: "auto" });

        expect(res.status).toBe(200);
        expect(res.report.shrunk).toBe(false);
        expect(res.report.savedPercent).toBe(0);
        expect(res.report.reason).toBeTruthy();
        // Not "the right length" - the right bytes.
        expect(Buffer.from(res.bytes).equals(before)).toBe(true);
    }, 600_000);

    it("refuses a damaged PDF and hands back the file, not a blank page", async () => {
        const source = corpusFile("adversarial/truncated.pdf")!;
        const before = fs.readFileSync(source);
        const res = await postFile(api.base, "/compress", source, { level: "auto" });

        expect(res.report.shrunk).toBe(false);
        expect(res.report.savedPercent).toBe(0);
        expect(Buffer.from(res.bytes).equals(before)).toBe(true);
    }, 600_000);

    it("never calls an empty file a 100% saving", async () => {
        // Zero bytes in, zero bytes out, and nothing anywhere claiming a win.
        // The arithmetic in `reportFor` divides by originalSize, so a naive
        // implementation reaches this case as NaN or Infinity rather than 0.
        const { status, body } = await postJson(api.base, "/compress", {
            level: "auto",
            files: [{ fileName: "zero.pdf", base64Bytes: "" }],
        });

        expect(status).toBe(200);
        const [file] = body.files;
        expect(file.shrunk).toBe(false);
        expect(file.compressedSize).toBe(0);
        expect(file.savedBytes).toBe(0);
        expect(file.savedPercent).toBe(0);
        expect(file.base64Bytes).toBe("");
    }, 600_000);

    it("rejects a zero-byte multipart upload for the reason that is actually true", async () => {
        // This used to answer "Missing 'file' field (must be a file upload)"
        // and the field was not missing. Bun's multipart parser drops the
        // `filename` from a part with no content - measured: a 1-byte part
        // arrives as `name: "one.pdf"`, a 0-byte part as `name: undefined` -
        // and the format is derived from the name, so the file arrives
        // unnameable rather than absent. The 400 is right; "missing" sent the
        // caller to inspect a form that had nothing wrong with it.
        const res = await postFile(api.base, "/compress", corpusFile("adversarial/zero.pdf")!);
        expect(res.status).toBe(400);

        const { error } = JSON.parse(Buffer.from(res.bytes).toString());
        expect(error).toMatch(/without a filename/i);
        expect(error, "the reply should point at the body shape that handles this file")
            .toMatch(/base64Bytes/);
        expect(error, "the field was present; do not call it missing").not.toMatch(/Missing 'file'/);
    }, 600_000);

    it("still says 'missing' when the file field really is missing", async () => {
        // The other half of the same branch. Making the empty-upload message
        // accurate is only worth anything if the genuinely-absent case did not
        // inherit it.
        const form = new FormData();
        form.append("level", "medium");
        const res = await fetch(`${api.base}/compress`, { method: "POST", body: form });

        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/Missing 'file' field/);
    }, 600_000);

    it("never returns a larger file, at any level", async () => {
        // Stated absolutely in the docs, so it gets a test that weighs the
        // response instead of reading the percentage the server printed.
        for (const rel of ["image/photo-mobile.jpg", "pdf/paper.pdf"]) {
            const source = corpusFile(rel)!;
            const before = fs.statSync(source).size;
            for (const level of ["auto", "high", "medium", "low"]) {
                const res = await postFile(api.base, "/compress", source, { level });
                expect(
                    res.bytes.byteLength,
                    `${rel} at ${level} returned ${res.bytes.byteLength} B for a ${before} B input`,
                ).toBeLessThanOrEqual(before);
            }
        }
    }, 900_000);

    it("the levels are distinct, not four names for one setting", async () => {
        // The `-crf` inertia bug produced four byte-identical outputs and
        // shipped green, because every test asserted that compression happened
        // rather than that the level changed anything.
        const source = corpusFile("image/photo-mobile.jpg")!;
        const sizes: Record<string, number> = {};
        for (const level of ["high", "medium", "low"]) {
            sizes[level] = (await postFile(api.base, "/compress", source, { level })).bytes.byteLength;
        }
        expect(new Set(Object.values(sizes)).size, `high/medium/low gave ${JSON.stringify(sizes)}`).toBe(3);
        // And in the order the names promise.
        expect(sizes.high).toBeGreaterThan(sizes.medium);
        expect(sizes.medium).toBeGreaterThan(sizes.low);
    }, 900_000);

    it("one unsupported file in a batch does not cost the caller the others", async () => {
        const { status, body } = await postJson(api.base, "/compress", {
            level: "medium",
            files: [
                { fileName: "notes.xyz", base64Bytes: toB64(Buffer.from("x".repeat(9000))) },
                { fileName: "paper.pdf", base64Bytes: toB64(fs.readFileSync(corpusFile("pdf/paper.pdf")!)) },
            ],
        });

        expect(status).toBe(200);
        const [unsupported, pdf] = body.files;

        expect(unsupported.shrunk).toBe(false);
        expect(unsupported.reason).toBeTruthy();
        // Returned whole. This is the defect that wrote 0-byte files into an
        // agent's folder and called it a 100% saving.
        expect(fromB64(unsupported.base64Bytes).byteLength).toBe(9000);

        expect(pdf.shrunk).toBe(true);
        expect(fromB64(pdf.base64Bytes).byteLength).toBe(pdf.compressedSize);
        expect(sniff(fromB64(pdf.base64Bytes))).toBe("pdf");
    }, 900_000);

    // --- convert ----------------------------------------------------------

    it("converts a real EPS to PDF", async () => {
        // #19's PostScript support has only ever been driven from the browser,
        // and only against files this project generated itself. tiger.eps is
        // somebody else's.
        const source = corpusFile("ps/tiger.eps")!;
        const { status, body } = await postJson(api.base, "/convert", {
            fileName: "tiger.eps",
            base64Bytes: toB64(fs.readFileSync(source)),
            inputMime: "application/postscript", inputExt: "eps",
            outputMime: "application/pdf", outputExt: "pdf",
        });

        expect(status).toBe(200);
        expect(Array.isArray(body), `convert answered ${JSON.stringify(body).slice(0, 200)}`).toBe(true);
        expect(body).toHaveLength(1);
        expect(body[0].fileName).toBe("tiger.pdf");

        const out = fromB64(body[0].base64Bytes);
        expect(sniff(out)).toBe("pdf");
        // Re-opened by a parser that had no part in producing it.
        expect((await inspectPdf(out)).pageCount).toBe(1);
    }, 600_000);

    // --- the PDF routes ---------------------------------------------------

    it("pdf/merge keeps every page, in order, with rotation intact", async () => {
        const sources = ["pdf/4pages.pdf", "adversarial/mixed-orientation.pdf", "pdf/forms.pdf"];
        const before = await Promise.all(
            sources.map(async s => inspectPdf(fs.readFileSync(corpusFile(s)!))));

        const { status, body } = await postJson(api.base, "/pdf/merge", { inputs: sources.map(ref) });
        expect(status).toBe(200);

        const out = fromB64(body.files[0].base64Bytes);
        const after = await inspectPdf(out);
        expect(after.pageCount).toBe(before.reduce((n, b) => n + b.pageCount, 0));

        // Order, which a page count cannot see. mixed-orientation.pdf carries
        // "MIXED 1".."MIXED 4" in its text, so the sequence is readable from
        // the output rather than inferred.
        const texts = await pdfPageTexts(out);
        expect(texts.flatMap(t => t.match(/MIXED \d+/) ?? []))
            .toEqual(["MIXED 1", "MIXED 2", "MIXED 3", "MIXED 4"]);
        expect(after.sizes.some(s => s.rot === 90), "rotation was flattened").toBe(true);
    }, 600_000);

    /**
     * Characterization, matching `corpus-pdf.test.ts`.
     *
     * Merging discards AcroForm fields: pdf-lib's copyPages carries the widget
     * annotations across but nothing rebuilds the destination AcroForm, so the
     * fields stop being fields. Known, tracked, and deliberately not fixed on a
     * release branch. What this adds over the browser suite is that REST agrees
     * - if the two surfaces ever diverge here, that divergence is the finding.
     */
    it("pdf/merge discards AcroForm fields, exactly as the browser does (known)", async () => {
        const before = await inspectPdf(fs.readFileSync(corpusFile("pdf/forms.pdf")!));
        expect(before.fields.length).toBeGreaterThan(0);

        const { body } = await postJson(api.base, "/pdf/merge", {
            inputs: [ref("pdf/4pages.pdf"), ref("pdf/forms.pdf")],
        });
        expect((await inspectPdf(fromB64(body.files[0].base64Bytes))).fields).toEqual([]);
    }, 600_000);

    it("pdf/organize reorders the pages it was told to reorder", async () => {
        const { status, body } = await postJson(api.base, "/pdf/organize", {
            inputs: [ref("adversarial/mixed-orientation.pdf")],
            pages: [4, 3, 2, 1].map(pageNum => ({ sourceIndex: 0, pageNum })),
        });
        expect(status).toBe(200);

        const out = fromB64(body.files[0].base64Bytes);
        expect((await pdfPageTexts(out)).flatMap(t => t.match(/MIXED \d+/) ?? []))
            .toEqual(["MIXED 4", "MIXED 3", "MIXED 2", "MIXED 1"]);
    }, 600_000);

    it("pdf/extract returns one document per page, holding the right page", async () => {
        const { status, body } = await postJson(api.base, "/pdf/extract", {
            input: ref("pdf/4pages.pdf"), pageNums: [2, 4],
        });
        expect(status).toBe(200);
        expect(body.files.map((f: { name: string }) => f.name))
            .toEqual(["4pages_page_2.pdf", "4pages_page_4.pdf"]);

        for (const f of body.files) {
            const out = fromB64(f.base64Bytes);
            expect(sniff(out)).toBe("pdf");
            expect((await inspectPdf(out)).pageCount).toBe(1);
        }
    }, 600_000);

    it("pdf/watermark marks exactly the pages asked for, and keeps the form", async () => {
        const marked = await postJson(api.base, "/pdf/watermark", {
            input: ref("adversarial/mixed-orientation.pdf"),
            text: "CONFIDENTIAL 2026", pageNums: [2],
        });
        expect(marked.status).toBe(200);

        const out = fromB64(marked.body.files[0].base64Bytes);
        const stamped = (await pdfPageTexts(out))
            .map((t, i) => (/CONFIDENTIAL/i.test(t) ? i + 1 : 0))
            .filter(Boolean);
        expect(stamped, "the watermark reached the wrong pages").toEqual([2]);

        // Watermarking stamps onto the existing pages instead of copying them
        // into a new document, so unlike merge it has no reason to lose the
        // form - and that is what proves the two paths differ for a reason.
        const source = corpusFile("pdf/forms.pdf")!;
        const fieldsBefore = (await inspectPdf(fs.readFileSync(source))).fields;
        const onForm = await postJson(api.base, "/pdf/watermark", {
            input: ref("pdf/forms.pdf"), text: "DRAFT",
        });
        expect((await inspectPdf(fromB64(onForm.body.files[0].base64Bytes))).fields)
            .toEqual(fieldsBefore);
    }, 600_000);

    it("serves from an ephemeral port, never the hardcoded default", () => {
        // Not pedantry. The server defaults to 3000, vitest runs files in
        // parallel workers, and a suite that assumed the default would fail as
        // a connection refusal inside a child process rather than as the port
        // conflict it is.
        expect(api.port).toBeGreaterThan(0);
        expect(api.port).not.toBe(3000);
    });
});
