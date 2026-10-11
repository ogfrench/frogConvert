// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser } from "puppeteer";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import JSZip from "jszip";
import {
    distBuilt, serveDist, launchBrowser, newTrackedPage, takeModalDownload,
    waitForRegistry, sleep, inspectPdf, type DistServer,
} from "../helpers/corpusBrowser.ts";

/**
 * Everyday conversions through the real Converter, judged on what comes out.
 *
 * The route graph and the Node verifier both said these worked while the site
 * shipped a 4-page PDF as 2 slides, an openpyxl spreadsheet as an error that
 * blamed the file, xlsx -> csv as pandoc's AST, and an Office document as one
 * picture reported as plain success. Bytes arriving is not the bar: each case
 * below asserts on the content, and on what the result modal tells the user.
 *
 * Runs against `dist/` (no LibreOffice reachable, as on frogconvert.xyz).
 * Opt-in like the stale-shell suite: FROG_E2E_MATRIX=1, or `bun run test:matrix`.
 */

const RES = path.resolve(__dirname, "../resources");
const requested = process.env.FROG_E2E_MATRIX === "1";
const TMP = path.join(os.tmpdir(), "frog-convert-matrix");

type Outcome = { files: { name: string; size: number }[]; dir: string; modal: string };

describe.skipIf(!requested || !distBuilt())("Converter matrix (opt-in: FROG_E2E_MATRIX=1)", () => {
    let server: DistServer;
    let browser: Browser;

    beforeAll(async () => {
        server = await serveDist();
        browser = await launchBrowser();
    }, 120_000);

    afterAll(async () => {
        await browser?.close();
        await server?.close();
    });

    async function convert(input: string, target: string): Promise<Outcome> {
        const dir = path.join(TMP, `${path.basename(input)}-to-${target}`);
        const { page } = await newTrackedPage(browser, dir);
        await page.goto(`${server.base}/`, { waitUntil: "networkidle0" });
        // "All" shows data targets (CSV, JSON) that the default Core list hides.
        await page.evaluate(() => (document.querySelector('#format-mode-menu [data-value="all"]') as HTMLElement | null)?.click());
        await waitForRegistry(page);
        const fileInput = await page.$("#file-input");
        await (fileInput as unknown as { uploadFile(p: string): Promise<void> }).uploadFile(input);
        await page.waitForSelector("#format-selector", { visible: true });
        await page.click("#format-selector");
        await page.waitForSelector("#format-modal.open");
        await sleep(800);
        const picked = await page.evaluate((t) => {
            const re = new RegExp(`^${t}\\b`, "i");
            const b = [...document.querySelectorAll<HTMLElement>(".format-option")]
                .find(o => re.test(o.textContent?.trim() ?? "") && !o.classList.contains("unavailable"));
            b?.click();
            return !!b;
        }, target.toUpperCase());
        if (!picked) throw new Error(`no ${target} target offered for ${path.basename(input)}`);
        await sleep(600);
        await page.$eval("#convert-button", b => (b as HTMLButtonElement).click());
        const { files, modalText } = await takeModalDownload(page, dir, 240_000);
        await page.close();
        if (!files?.length) throw new Error(`no download; modal said: ${modalText}`);
        return { files, dir, modal: modalText };
    }

    const read = (o: Outcome) => fs.readFileSync(path.join(o.dir, o.files[0].name));

    it("pdf -> pptx gives one slide per page, and says the slides are pictures", async () => {
        const o = await convert(path.join(RES, "deck-4pages.pdf"), "pptx");
        const zip = await JSZip.loadAsync(read(o));
        const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
        expect(slides).toHaveLength(4);
        expect(o.modal).toMatch(/made of pictures/);
    }, 300_000);

    it("xlsx (openpyxl) -> csv gives the cells in sheet order", async () => {
        const o = await convert(path.join(RES, "sheet.xlsx"), "csv");
        expect(read(o).toString("utf8").trim()).toBe("Region,Q2,Q3\nNorth,10,12\nSouth,8,9");
        expect(o.modal).not.toMatch(/with limits/);
    }, 300_000);

    it("xlsx (openpyxl) -> json gives one object per row", async () => {
        const o = await convert(path.join(RES, "sheet.xlsx"), "json");
        expect(JSON.parse(read(o).toString("utf8"))).toEqual([
            { Region: "North", Q2: 10, Q3: 12 },
            { Region: "South", Q2: 8, Q3: 9 },
        ]);
    }, 300_000);

    it("xlsx (openpyxl) -> pdf succeeds, labelled as pictures", async () => {
        const o = await convert(path.join(RES, "sheet.xlsx"), "pdf");
        expect((await inspectPdf(read(o))).pageCount).toBeGreaterThan(0);
        expect(o.modal).toMatch(/with limits/);
        expect(o.modal).toMatch(/made of pictures/);
    }, 300_000);

    it("pptx -> pdf is labelled as pictures, not celebrated", async () => {
        const o = await convert(path.join(RES, "deck.pptx"), "pdf");
        expect((await inspectPdf(read(o))).pageCount).toBeGreaterThan(0);
        expect(o.modal).toMatch(/File converted, with limits/);
    }, 300_000);

    it("docx -> pdf is labelled as pictures", async () => {
        const o = await convert(path.join(RES, "word.docx"), "pdf");
        expect(o.modal).toMatch(/made of pictures/);
    }, 300_000);

    it("the page is cross-origin isolated, as netlify.toml serves it", async () => {
        const { page } = await newTrackedPage(browser, path.join(TMP, "isolation"));
        await page.goto(`${server.base}/`, { waitUntil: "networkidle0" });
        expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
        await page.close();
    }, 120_000);

    // sqlite-wasm is the one engine that behaves differently once
    // SharedArrayBuffer exists: it tries to install an OPFS VFS on start.
    it("csv -> sqlite still works under cross-origin isolation", async () => {
        const o = await convert(path.join(RES, "table.csv"), "sqlite3");
        expect(read(o).subarray(0, 15).toString("latin1")).toBe("SQLite format 3");
    }, 300_000);

    it("png -> jpg is a plain success with no notice", async () => {
        const o = await convert(path.join(RES, "colors_50x50.png"), "jpeg");
        expect(read(o).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
        expect(o.modal).toMatch(/File converted!/);
        expect(o.modal).not.toMatch(/made of pictures|with limits/);
    }, 300_000);
});
