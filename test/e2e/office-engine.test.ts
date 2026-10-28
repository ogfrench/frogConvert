// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser, Page } from "puppeteer";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
    DIST, distBuilt, serveDist, launchBrowser, newTrackedPage, takeModalDownload,
    waitForRegistry, sleep, inspectPdf, pdfPageTexts, type DistServer,
} from "../helpers/corpusBrowser.ts";
import { OFFICE_ENGINE_BASE } from "../../src/core/officeEngine/officeEngineAssets.ts";

/**
 * The browser Office engine, end to end through the real Converter: offered,
 * downloaded, used for Office -> PDF, and still there after a reload.
 *
 * Opt-in (FROG_E2E_ENGINE=1, `bun run test:engine`) and needs the engine in
 * dist/ (`bun run build && bun run build:office-engine`). Run it with a system
 * Chromium (PUPPETEER_EXECUTABLE_PATH): Puppeteer's bundled Chrome ran this
 * engine about 40 times slower than Chromium on the same machine (83 s against
 * 2 s for one deck), which would only measure the harness.
 */

const RES = path.resolve(__dirname, "../resources");
const requested = process.env.FROG_E2E_ENGINE === "1";
const engineBuilt = fs.existsSync(path.join(DIST, OFFICE_ENGINE_BASE.replace(/^\//, ""), "manifest.json"));
const TMP = path.join(os.tmpdir(), "frog-office-engine");

describe.skipIf(!requested || !distBuilt() || !engineBuilt)("Browser Office engine (opt-in: FROG_E2E_ENGINE=1)", () => {
    let server: DistServer;
    let browser: Browser;
    let page: Page;
    const partRequests: string[] = [];

    beforeAll(async () => {
        fs.rmSync(TMP, { recursive: true, force: true });
        server = await serveDist();
        browser = await launchBrowser();
        ({ page } = await newTrackedPage(browser, TMP));
        await page.setViewport({ width: 1280, height: 900 });
        page.on("request", r => { if (/\.gz\.\d{3}$/.test(r.url())) partRequests.push(r.url()); });
    }, 120_000);

    afterAll(async () => {
        await browser?.close();
        await server?.close();
    });

    async function pickToPdf(input: string) {
        const fileInput = await page.$("#file-input");
        await (fileInput as unknown as { uploadFile(p: string): Promise<void> }).uploadFile(input);
        await page.waitForSelector("#format-selector", { visible: true });
        await page.click("#format-selector");
        await page.waitForSelector("#format-modal.open");
        await sleep(800);
        await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".format-option")]
            .find(o => /^PDF\b/i.test(o.textContent?.trim() ?? "") && !o.classList.contains("unavailable"))?.click());
        await sleep(1000);
    }

    async function convert() {
        await page.$eval("#convert-button", b => (b as HTMLButtonElement).click());
        const { files, modalText } = await takeModalDownload(page, TMP, 120_000);
        if (!files?.length) throw new Error(`no download; modal said: ${modalText}`);
        return { bytes: fs.readFileSync(path.join(TMP, files[0].name)), modal: modalText };
    }

    it("offers the engine, downloads it, and turns a deck into a real PDF", async () => {
        await page.goto(`${server.base}/`, { waitUntil: "networkidle0" });
        await waitForRegistry(page);
        await pickToPdf(path.join(RES, "deck.pptx"));

        const offer = await page.$eval("#libreoffice-notice", n => n.textContent ?? "");
        expect(offer).toMatch(/Get a high-quality PDF/);
        await page.click("#office-engine-download");
        await page.waitForFunction(() => /Office engine ready|didn't finish/
            .test(document.querySelector("#libreoffice-notice")?.textContent ?? ""), { timeout: 300_000 });
        expect(await page.$eval("#libreoffice-notice", n => n.textContent ?? "")).toMatch(/Office engine ready/);
        expect(partRequests.length).toBeGreaterThan(0);
        await sleep(1500);

        const { bytes, modal } = await convert();
        expect(modal).toMatch(/File converted!/);
        expect(modal).not.toMatch(/with limits|made of pictures/);
        expect((await inspectPdf(bytes)).pageCount).toBe(4);
        expect((await pdfPageTexts(bytes)).join(" ")).toMatch(/Quarterly Review/);
    }, 600_000);

    it("uses the cached engine after a reload, without downloading it again", async () => {
        const before = partRequests.length;
        await page.goto(`${server.base}/`, { waitUntil: "networkidle0" });
        await waitForRegistry(page);
        await page.waitForFunction(() => (window.supportedFormatCache?.get("libreoffice")?.length ?? 0) > 0, { timeout: 30_000 });
        await pickToPdf(path.join(RES, "sheet.xlsx"));
        expect(await page.$eval("#libreoffice-notice", n => (n as HTMLElement).hidden)).toBe(true);

        const { bytes, modal } = await convert();
        expect(modal).not.toMatch(/with limits|made of pictures/);
        expect((await pdfPageTexts(bytes)).join(" ")).toMatch(/Region/);
        expect(partRequests.length).toBe(before);
    }, 600_000);
    it("shows the engine offer on a touch viewport without a warning toast", async () => {
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        await page.goto(`${server.base}/`, { waitUntil: "networkidle0" });
        await waitForRegistry(page);
        expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
        await pickToPdf(path.join(RES, "deck.pptx"));
        await page.waitForFunction(() => (window.supportedFormatCache?.get("libreoffice")?.length ?? 0) > 0, { timeout: 30_000 });
        expect(await page.$eval("#libreoffice-notice", el => (el as HTMLElement).hidden)).toBe(true);
        expect(await page.$eval("body", el => !!el.querySelector(".toast.variant-warn.open"))).toBe(false);
        const { bytes, modal } = await convert();
        expect(modal).not.toMatch(/with limits|made of pictures/);
        expect((await inspectPdf(bytes)).pageCount).toBe(4);
    }, 600_000);


});
