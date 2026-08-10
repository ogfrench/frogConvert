// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser, Page } from "puppeteer";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { corpusFile, hasCorpus, reportCorpusSkips, CORPUS_REASON } from "../helpers/corpus.ts";
import {
    distBuilt, serveDist, launchBrowser, newTrackedPage, takeModalDownload,
    sleep, waitForRegistry, type DistServer,
} from "../helpers/corpusBrowser.ts";

/**
 * The Converter, weighed rather than believed.
 *
 * One invariant carries this file: **the success modal's claim about
 * compression must agree with the bytes on disk.** That is not an abstract
 * property. The modal used to print "Compressed at Smallest file" above a file
 * 126 bytes LARGER than the input, because the level was announced from the
 * user's setting rather than from whether the final handler could act on it -
 * `usesQuality` existed but nothing consulted it at the point of the claim.
 *
 * Expressed as a test the invariant is format-agnostic, which matters: it does
 * not need to know in advance which targets honour a quality level. It runs the
 * same conversion twice, reads what the app says, and holds it to it.
 *
 *   claim "Compressed at X"            => the bytes must actually differ
 *   claim "not available for X"        => the bytes must be identical
 */

const NEEDED = ["image/photo-mobile.jpg", "pdf/4pages.pdf"];

const ready = hasCorpus(...NEEDED) && distBuilt();
const TMP = path.join(os.tmpdir(), "frog-corpus-convert");

describe.skipIf(!ready)(`Convert against the real corpus [${CORPUS_REASON}]`, () => {
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

    /** Pick a target format through the real modal, by its display name. */
    async function chooseFormat(page: Page, ext: string) {
        await page.click("#format-selector");
        await page.waitForSelector("#format-modal.open", { timeout: 15_000 });
        // Search rather than scroll: the list can hold ~70 options and the
        // Core/Plus/All mode decides which are even rendered.
        await page.type("#format-search", ext);
        await sleep(600);
        // Display names are "PNG - Portable Network Graphics", so the extension
        // is the prefix. `.unavailable` options are rendered but inert - picking
        // one silently does nothing, which would look like a conversion failure.
        const picked = await page.evaluate((e) => {
            const want = new RegExp(`^${e}\\b`, "i");
            const btn = [...document.querySelectorAll<HTMLElement>(".format-option")]
                .find(b => want.test(b.textContent?.trim() ?? "")
                    && !b.classList.contains("unavailable"));
            if (!btn) return false;
            btn.click();
            return true;
        }, ext.toUpperCase());
        if (!picked) throw new Error(`no available format option for "${ext}"`);
        await sleep(600);
    }

    /**
     * One conversion, end to end: level, file, target, button, modal, download.
     * Returns what the app said and what actually landed on disk.
     */
    async function convert(opts: { file: string; to: string; quality: string; tag: string }) {
        const dir = path.join(TMP, opts.tag);
        const { page, violations: v } = await newTrackedPage(browser, dir);
        // The level is persisted state, so it is set before the app boots
        // rather than by driving the settings menu - this test is about the
        // claim the modal makes, not about the menu that sets it.
        await page.evaluateOnNewDocument((q) => {
            try { localStorage.setItem("convertQuality", q); } catch { /* private mode */ }
        }, opts.quality);

        await page.goto(`${server.base}/`, { waitUntil: "networkidle2", timeout: 90_000 });
        await page.waitForSelector("#file-input", { timeout: 30_000 });
        const input = await page.$("#file-input");
        await input!.uploadFile(opts.file);
        await waitForRegistry(page);

        await chooseFormat(page, opts.to);
        await page.click("#convert-button");

        const { files, modalText } = await takeModalDownload(page, dir);
        const csp = await v();
        await page.close();
        return { files, modalText, dir, csp };
    }

    it("the modal's compression claim agrees with the bytes on disk", async () => {
        const source = corpusFile("image/photo-mobile.jpg")!;
        const outcomes: { to: string; claimed: boolean; original: number; smallest: number }[] = [];

        for (const to of ["png", "webp"]) {
            const original = await convert({ file: source, to, quality: "lossless", tag: `${to}-orig` });
            const smallest = await convert({ file: source, to, quality: "low", tag: `${to}-low` });

            expect(original.files, `${to} at Original produced no download`).not.toBeNull();
            expect(smallest.files, `${to} at Smallest produced no download`).not.toBeNull();

            const a = original.files![0].size;
            const b = smallest.files![0].size;
            const claimed = /Compressed at/i.test(smallest.modalText);
            const disclaimed = /Compression is not available/i.test(smallest.modalText);

            // Exactly one of the two clauses, never both and never neither -
            // silence is how the overclaim went unnoticed for a release.
            expect(claimed !== disclaimed,
                `${to}: modal said neither or both. Text: ${smallest.modalText}`).toBe(true);

            if (claimed) {
                expect(b, `${to}: modal claimed compression but ${b} B >= ${a} B`).toBeLessThan(a);
            } else {
                expect(b, `${to}: modal disclaimed compression but bytes moved ${a} -> ${b}`).toBe(a);
            }

            // And the output really is the format it says. A converter that
            // hands back the input renamed would satisfy every size assertion
            // above.
            const head = fs.readFileSync(path.join(original.dir, original.files![0].name)).subarray(0, 12);
            if (to === "png") {
                expect([...head.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
            } else {
                expect(head.subarray(0, 4).toString("latin1")).toBe("RIFF");
                expect(head.subarray(8, 12).toString("latin1")).toBe("WEBP");
            }
            expect(original.files![0].name.toLowerCase().endsWith(`.${to}`)).toBe(true);

            outcomes.push({ to, claimed, original: a, smallest: b });
            violations = [...original.csp, ...smallest.csp];
        }

        // The invariant above is satisfied trivially if the app never claims
        // compression anywhere - a regression that broke every quality path
        // would leave this test green while the feature was gone. At least one
        // of these targets must actually honour the level.
        console.info("[corpus-convert] " + outcomes
            .map(o => `${o.to}: ${o.claimed ? "claimed" : "disclaimed"} ${o.original} -> ${o.smallest} B`)
            .join(" | "));
        expect(outcomes.some(o => o.claimed),
            "no target honoured Smallest file; the quality path may be dead").toBe(true);
    }, 900_000);

    it("a multi-page PDF converted to images says how many files it became", async () => {
        // The output count is not the input count, and the modal used to report
        // the input one: a single 3-page PDF converted to EPS announced
        // "3 files converted" when the user had converted one. Both numbers now
        // appear, and this is the case that produces them.
        const r = await convert({
            file: corpusFile("pdf/4pages.pdf")!, to: "png", quality: "lossless", tag: "pdf-png",
        });
        expect(r.files, "PDF -> PNG produced no download").not.toBeNull();
        expect(r.modalText).toMatch(/became .*4 png files.*one per page/i);

        // The zip really holds four images; the sentence alone is a claim.
        const zipPath = path.join(r.dir, r.files![0].name);
        expect(zipPath.toLowerCase().endsWith(".zip")).toBe(true);
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
        const entries = Object.values(zip.files).filter(f => !f.dir);
        expect(entries.length).toBe(4);
        for (const entry of entries) {
            const bytes = await entry.async("uint8array");
            expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
        }
    }, 900_000);

    it("raises no CSP violations, which would hang rather than error", () => {
        expect(violations).toEqual([]);
    });
});
