// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser } from "puppeteer";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { corpusFile, hasCorpus, reportCorpusSkips, CORPUS_REASON } from "../helpers/corpus.ts";
import {
    DIST, distBuilt, serveDist, launchBrowser, newTrackedPage, takeModalDownload,
    clickByText, inspectPdf, pdfPageTexts, sleep, waitForRegistry, type DistServer,
} from "../helpers/corpusBrowser.ts";

/**
 * The PDF editor, driven through the real UI, with every output re-opened by a
 * parser that had no part in producing it.
 *
 * The claims here had never been checked against structure. Page COUNT is easy
 * and was covered; page ORDER, rotation, and - the one nobody had looked at at
 * all - whether a document's AcroForm fields still exist afterwards, were not.
 * A merge that returns the right number of pages in the wrong order passes
 * every count-based check there is.
 */

const NEEDED = [
    "pdf/4pages.pdf",
    "pdf/forms.pdf",
    "adversarial/mixed-orientation.pdf",
];

const ready = hasCorpus(...NEEDED) && distBuilt();
const TMP = path.join(os.tmpdir(), "frog-corpus-pdf");

describe.skipIf(!ready)(`PDF editor against the real corpus [${CORPUS_REASON}]`, () => {
    let server: DistServer;
    let browser: Browser;
    let violations: string[] = [];

    beforeAll(async () => {
        server = await serveDist();
        browser = await launchBrowser();
    }, 180_000);

    afterAll(async () => {
        try { await browser?.close(); } catch { /* slow teardown */ }
        await server?.close();
        fs.rmSync(TMP, { recursive: true, force: true });
        reportCorpusSkips();
    }, 60_000);

    /** Open the editor on a set of corpus files and wait for them to land. */
    async function openEditor(files: string[], downloadDir: string) {
        const tracked = await newTrackedPage(browser, downloadDir);
        await tracked.page.goto(`${server.base}/pdf`, { waitUntil: "networkidle2", timeout: 90_000 });
        await tracked.page.waitForSelector("#workspace-file-input", { timeout: 30_000 });
        const input = await tracked.page.$("#workspace-file-input");
        await input!.uploadFile(...files);
        await waitForRegistry(tracked.page);
        return tracked;
    }

    it("merge: keeps every page, in order, with rotation intact", async () => {
        const sources = [
            corpusFile("pdf/4pages.pdf")!,
            corpusFile("adversarial/mixed-orientation.pdf")!,
            corpusFile("pdf/forms.pdf")!,
        ];
        const dir = path.join(TMP, "merge");
        const { page, violations: v } = await openEditor(sources, dir);

        const before = await Promise.all(sources.map(s => inspectPdf(fs.readFileSync(s))));
        await clickByText(page, "Merge PDF");
        const { files } = await takeModalDownload(page, dir);
        expect(files, "Download was pressed and nothing landed").not.toBeNull();

        const bytes = fs.readFileSync(path.join(dir, files![0].name));
        const after = await inspectPdf(bytes);

        // Count first, because a merge that drops a document is the loud failure.
        expect(after.pageCount).toBe(before.reduce((s, b) => s + b.pageCount, 0));

        // Then ORDER, which count cannot see. mixed-orientation.pdf carries
        // "MIXED 1".."MIXED 4" in its page text, so the sequence is readable
        // from the output rather than inferred from thumbnails.
        const texts = await pdfPageTexts(bytes);
        const markers = texts.flatMap(t => t.match(/MIXED \d+/) ?? []);
        expect(markers).toEqual(["MIXED 1", "MIXED 2", "MIXED 3", "MIXED 4"]);

        // And rotation, which survives copyPages but is exactly the kind of
        // per-page attribute a hand-rolled merge would flatten.
        expect(after.sizes.some(s => s.rot === 90)).toBe(true);

        violations = await v();
    }, 900_000);

    /**
     * Characterization, not a guarantee: this asserts what the app does today,
     * which is NOT what it should do.
     *
     * forms.pdf has three AcroForm fields (Name, Check, Submit). After a merge
     * they are gone - pdf-lib's copyPages carries the widget annotations across
     * but nothing rebuilds the destination AcroForm, so the fields stop being
     * fields. Filed as an issue rather than fixed here, because merging two
     * documents that both define a field called "Name" has no obviously correct
     * answer and a release branch at sign-off is the wrong place to pick one.
     *
     * When somebody does fix it this test goes red. That is the point: delete
     * it and assert preservation instead.
     */
    it("merge: currently discards AcroForm fields (known, tracked)", async () => {
        const dir = path.join(TMP, "merge-forms");
        const { page } = await openEditor(
            [corpusFile("pdf/4pages.pdf")!, corpusFile("pdf/forms.pdf")!], dir);

        const before = await inspectPdf(fs.readFileSync(corpusFile("pdf/forms.pdf")!));
        expect(before.fields.length).toBeGreaterThan(0);

        await clickByText(page, "Merge PDF");
        const { files } = await takeModalDownload(page, dir);
        expect(files).not.toBeNull();
        const after = await inspectPdf(fs.readFileSync(path.join(dir, files![0].name)));
        expect(after.fields).toEqual([]);
    }, 900_000);

    it("watermark: marks the page, keeps the page count, and keeps the form fields", async () => {
        const dir = path.join(TMP, "watermark");
        const { page } = await openEditor([corpusFile("pdf/forms.pdf")!], dir);
        const before = await inspectPdf(fs.readFileSync(corpusFile("pdf/forms.pdf")!));

        await page.click("#pdf-tab-watermark");
        await sleep(2500);
        const field = await page.$(".ws-wm-text, textarea, input[type=text]");
        expect(field, "watermark tab has no text field").not.toBeNull();
        await field!.click({ clickCount: 3 });
        await field!.type("CONFIDENTIAL 2026");
        await sleep(1500);

        await page.evaluate(() => {
            const b = document.querySelector<HTMLElement>(".ws-wm-download-btn")
                ?? [...document.querySelectorAll<HTMLElement>(".ws-action-btn")]
                    .find(b => b.offsetParent !== null);
            b?.click();
        });
        const { files } = await takeModalDownload(page, dir);
        expect(files).not.toBeNull();

        const bytes = fs.readFileSync(path.join(dir, files![0].name));
        const after = await inspectPdf(bytes);
        const texts = await pdfPageTexts(bytes);

        expect(after.pageCount).toBe(before.pageCount);
        expect(texts.filter(t => /CONFIDENTIAL/i.test(t)).length).toBe(after.pageCount);
        // Watermark stamps content onto existing pages rather than copying them
        // into a new document, so unlike merge it has no reason to lose the
        // form - and this is what proves the two paths differ for a reason.
        expect(after.fields).toEqual(before.fields);
    }, 900_000);

    it("organize: exporting an untouched document returns it unchanged", async () => {
        const dir = path.join(TMP, "organize");
        const source = corpusFile("adversarial/mixed-orientation.pdf")!;
        const { page } = await openEditor([source], dir);
        const before = await inspectPdf(fs.readFileSync(source));

        // The workspace opens on Merge whatever it was given, so a single-file
        // journey starts with a tab change. Worth stating rather than assuming:
        // this test failed first time round looking for an Export button that
        // exists only once Organize is showing.
        await page.click("#pdf-tab-organize");
        await sleep(2500);

        // No edits: the editor's promise is that it hands back the document you
        // edited, and the null edit is the cheapest case where silent damage -
        // a dropped rotation, a re-ordered page, a rasterised page - would show.
        await clickByText(page, "Export PDF");
        const { files } = await takeModalDownload(page, dir);
        expect(files).not.toBeNull();

        const bytes = fs.readFileSync(path.join(dir, files![0].name));
        const after = await inspectPdf(bytes);
        expect(after.pageCount).toBe(before.pageCount);
        expect(after.sizes).toEqual(before.sizes);
        const texts = await pdfPageTexts(bytes);
        expect(texts.flatMap(t => t.match(/MIXED \d+/) ?? []))
            .toEqual(["MIXED 1", "MIXED 2", "MIXED 3", "MIXED 4"]);
    }, 900_000);

    it("raises no CSP violations, which would hang rather than error", () => {
        expect(violations).toEqual([]);
        // Guards against the assertion above passing because dist/ was stale.
        expect(fs.existsSync(path.join(DIST, "_headers"))).toBe(true);
    });
});
