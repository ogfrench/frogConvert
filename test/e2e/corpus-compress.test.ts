// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser } from "puppeteer";
import { corpusFile, hasCorpus, reportCorpusSkips, CORPUS_REASON } from "../helpers/corpus.ts";
import {
    distBuilt, serveDist, launchBrowser, runCompress, type DistServer,
} from "../helpers/corpusBrowser.ts";

/**
 * Compression, driven through the built app, against real files.
 *
 * These are the checks that found every defect worth finding in v3, and until
 * now they existed only as throwaway scripts in somebody's scratch directory -
 * which meant the most valuable tests in the project were the ones nobody could
 * re-run. The findings they encode:
 *
 *  - a password-protected PDF was emptied and reported as an 83% saving
 *  - Automatic refused a 5.1 MB thesis it could take to 1.8 MB
 *  - a truncated PDF came back as a blank page called a 99% win
 *  - a .webm was not recognised as input at all
 *
 * Each of those was invisible to a green unit suite, because each lived in a
 * seam between mocked units.
 */

const NEEDED = [
    "pdf/paper.pdf",
    "pdf/large-text.pdf",
    "pdf/password.pdf",
    "image/photo-mobile.jpg",
    "adversarial/truncated.pdf",
    "adversarial/zero.pdf",
];

const ready = hasCorpus(...NEEDED) && distBuilt();

describe.skipIf(!ready)(`Compress against the real corpus [${CORPUS_REASON}]`, () => {
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
        reportCorpusSkips();
    }, 60_000);

    const run = async (files: string[], level: string) => {
        const r = await runCompress(browser, server.base, files, level);
        violations = r.csp;
        return r;
    };

    it("empties nothing: a password-protected PDF is refused, not reported as a saving", async () => {
        const r = await run([corpusFile("pdf/password.pdf")!, corpusFile("pdf/paper.pdf")!], "auto");
        const pw = r.row("password.pdf");
        expect(pw, "password.pdf missing from the results").toBeDefined();
        expect(pw!.shrunk, "an encrypted PDF must never report a saving").toBe(false);
        expect(pw!.note).toMatch(/failed/i);
        // The ordinary file in the same batch still works.
        expect(r.row("paper.pdf")!.shrunk).toBe(true);
    }, 900_000);

    it("does not refuse a long text PDF at Automatic", async () => {
        const r = await run([corpusFile("pdf/large-text.pdf")!], "auto");
        const doc = r.row("large-text.pdf");
        expect(doc!.shrunk, "Automatic used to hand this back as 'already compressed'").toBe(true);
        // Measured -65%; assert the shape, not the exact figure, so a Ghostscript
        // bump does not fail a test about behaviour.
        expect(parseInt(doc!.pct.replace(/\D/g, ""), 10)).toBeGreaterThan(40);
    }, 900_000);

    it("refuses damaged and empty files instead of inventing a win", async () => {
        const r = await run(
            [corpusFile("adversarial/truncated.pdf")!, corpusFile("adversarial/zero.pdf")!], "auto");
        expect(r.row("truncated.pdf")!.shrunk).toBe(false);
        expect(r.row("truncated.pdf")!.note).toMatch(/failed/i);
        const zero = r.row("zero.pdf")!;
        expect(zero.shrunk).toBe(false);
        // An empty file is not "already compressed" - there is nothing in it.
        expect(zero.note).not.toMatch(/already/i);
    }, 900_000);

    it("compresses a real photo substantially", async () => {
        const r = await run([corpusFile("image/photo-mobile.jpg")!], "auto");
        const img = r.row("photo-mobile.jpg")!;
        expect(img.shrunk).toBe(true);
        expect(parseInt(img.pct.replace(/\D/g, ""), 10)).toBeGreaterThan(50);
    }, 900_000);

    it("raises no CSP violations, which would hang rather than error", () => {
        expect(violations).toEqual([]);
    });
});
