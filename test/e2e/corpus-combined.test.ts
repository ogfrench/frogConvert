// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser } from "puppeteer";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { corpusFile, hasCorpus, reportCorpusSkips, CORPUS_REASON } from "../helpers/corpus.ts";
import {
    distBuilt, serveDist, launchBrowser, newTrackedPage, takeModalDownload, runCompress,
    clickByText, inspectPdf, sleep, waitForRegistry, type DistServer,
} from "../helpers/corpusBrowser.ts";

/**
 * The seams between surfaces - the part nothing else covers.
 *
 * Every suite in this project tests one surface in isolation, and every serious
 * defect this release found lived where two of them meet. A user does not stop
 * at one surface: they convert a photo and then compress the result, or they
 * merge a scan and expect the editor's own compression level to have been
 * applied to what they saved. Both journeys cross code that no single-surface
 * test exercises - the second one crosses `setPdfResult`, which decides whether
 * the save is compressed at all and whether the modal says so.
 */

const NEEDED = ["image/photo-mobile.jpg", "pdf/scanned-images.pdf"];

const ready = hasCorpus(...NEEDED) && distBuilt();
const TMP = path.join(os.tmpdir(), "frog-corpus-combined");

describe.skipIf(!ready)(`Cross-surface journeys against the real corpus [${CORPUS_REASON}]`, () => {
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

    it("convert then compress: the app's own output is a valid input", async () => {
        // A PNG straight out of the Converter is the single most likely file to
        // arrive on the Compress surface, and it is a file no fixture directory
        // contains: it was produced moments earlier by the code under test.
        const dir = path.join(TMP, "convert");
        const { page, violations: v } = await newTrackedPage(browser, dir);
        await page.goto(`${server.base}/`, { waitUntil: "networkidle2", timeout: 90_000 });
        await page.waitForSelector("#file-input", { timeout: 30_000 });
        const input = await page.$("#file-input");
        await input!.uploadFile(corpusFile("image/photo-mobile.jpg")!);
        await waitForRegistry(page);

        await page.click("#format-selector");
        await page.waitForSelector("#format-modal.open", { timeout: 15_000 });
        await page.type("#format-search", "png");
        await sleep(600);
        const picked = await page.evaluate(() => {
            const btn = [...document.querySelectorAll<HTMLElement>(".format-option")]
                .find(b => /^PNG\b/i.test(b.textContent?.trim() ?? "")
                    && !b.classList.contains("unavailable"));
            if (!btn) return false;
            btn.click();
            return true;
        });
        expect(picked, "PNG was not offered as a target").toBe(true);
        await sleep(600);
        await page.click("#convert-button");

        const { files } = await takeModalDownload(page, dir);
        expect(files, "conversion produced no download").not.toBeNull();
        const converted = path.join(dir, files![0].name);
        const convertedSize = fs.statSync(converted).size;
        const cspConvert = await v();
        await page.close();

        // Now hand that file to Compress. A PNG out of a JPEG is large and
        // lossless, so this is a genuine compression job rather than a file
        // that was going to be kept whatever happened.
        const compressDir = path.join(TMP, "compress");
        const r = await runCompress(browser, server.base, [converted], "auto", compressDir);
        const row = r.row(path.basename(converted));
        expect(row, `${path.basename(converted)} missing from the Compress results`).toBeDefined();

        // The never-worse promise, on a file the app made itself: either it
        // shrank and the download is genuinely smaller, or it was kept and
        // nothing claims otherwise.
        if (row!.shrunk) {
            expect(r.download, "a shrunk file offered no download").not.toBeNull();
            const out = r.download!.reduce((n, f) => n + f.size, 0);
            expect(out).toBeLessThan(convertedSize);
        } else {
            expect(row!.note).not.toMatch(/smaller|saved/i);
        }

        violations = [...cspConvert, ...r.csp];
    }, 900_000);

    it("pdf editor then compress: the level reaches the saved file, and the claim matches it", async () => {
        // Same invariant the Converter is held to, on the other surface that
        // makes a compression claim: the clause appears if and only if the
        // bytes moved. `setPdfResult` decides both, in one place, and until
        // this branch it decided them independently.
        const source = corpusFile("pdf/scanned-images.pdf")!;
        const sourceShape = await inspectPdf(fs.readFileSync(source));

        const save = async (quality: string, tag: string) => {
            const dir = path.join(TMP, tag);
            const { page } = await newTrackedPage(browser, dir);
            await page.evaluateOnNewDocument((q) => {
                try { localStorage.setItem("pdfQuality", q); } catch { /* private mode */ }
            }, quality);
            await page.goto(`${server.base}/pdf`, { waitUntil: "networkidle2", timeout: 90_000 });
            await page.waitForSelector("#workspace-file-input", { timeout: 30_000 });
            const input = await page.$("#workspace-file-input");
            await input!.uploadFile(source);
            await waitForRegistry(page);
            // The workspace opens on Merge; Export lives under Organize.
            await page.click("#pdf-tab-organize");
            await sleep(2500);
            await clickByText(page, "Export PDF");
            const { files, modalText } = await takeModalDownload(page, dir);
            await page.close();
            expect(files, `${quality}: export produced no download`).not.toBeNull();
            return {
                bytes: fs.readFileSync(path.join(dir, files![0].name)),
                size: files![0].size,
                modalText,
            };
        };

        const original = await save("lossless", "pdf-orig");
        const smallest = await save("low", "pdf-low");

        // Whatever the level, the document that comes back is the document
        // that went in. A PDF that shrinks by losing a page is not a win.
        expect((await inspectPdf(original.bytes)).pageCount).toBe(sourceShape.pageCount);
        expect((await inspectPdf(smallest.bytes)).pageCount).toBe(sourceShape.pageCount);

        // The clause reads "Compressed 15.6 KB → 4.7 KB." and appears only when
        // the pass actually saved something. At Original quality no pass runs,
        // so there is nothing to say.
        const CLAUSE = /Compressed\s+([\d.]+)\s*(B|KB|MB)\s*→\s*([\d.]+)\s*(B|KB|MB)/;
        expect(CLAUSE.test(original.modalText),
            `Original quality claimed compression: ${original.modalText}`).toBe(false);

        const claim = smallest.modalText.match(CLAUSE);
        if (claim) {
            expect(smallest.size,
                `modal claimed a saving but ${smallest.size} B >= ${original.size} B`)
                .toBeLessThan(original.size);

            // And the number in the sentence is the number on disk. A clause
            // built from the right intent but the wrong buffer would satisfy
            // every inequality above while telling the user a figure that is
            // not the file they just downloaded.
            const unit: Record<string, number> = { B: 1, KB: 1024, MB: 1024 * 1024 };
            const claimedAfter = parseFloat(claim[3]) * unit[claim[4]];
            // formatBytes rounds to one decimal, so allow the rounding step.
            expect(Math.abs(claimedAfter - smallest.size) / smallest.size,
                `modal said ${claim[3]} ${claim[4]}, disk says ${smallest.size} B`)
                .toBeLessThan(0.02);
        } else {
            // Silence is allowed - "compressed, 0% smaller" is worse than
            // nothing - but only when the file really did not get smaller.
            expect(smallest.size,
                `no compression clause, yet the file shrank: ${original.size} -> ${smallest.size} B`)
                .toBeGreaterThanOrEqual(original.size);
        }
    }, 900_000);

    it("raises no CSP violations, which would hang rather than error", () => {
        expect(violations).toEqual([]);
    });
});
