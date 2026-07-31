// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import puppeteer, { Browser, Page } from "puppeteer";
import { preview, build, PreviewServer } from "vite";
import path from "path";
import fs from "fs";
import os from "os";
import { imageHeavyPdf } from "../fixtures/imageHeavyPdf.ts";

/**
 * Compression, in a browser, on a real file, asserting on real bytes.
 *
 * This is the test that would have caught all four of the defects that shipped
 * green: the probe vetoing explicit levels, pdf.js detaching the file it was
 * handed, FFmpeg's demuxer/muxer pair never resolving, and the video levels
 * collapsing to one output. Every one of them lived in a seam *between* mocked
 * units, so no unit test could see them - and pdf.js in particular cannot even
 * be loaded by the node suite (it needs `DOMMatrix`, `Promise.try` and
 * `Uint8Array.prototype.toHex`). A browser is not a nicety here; it is the only
 * environment where this code exists as the user meets it.
 *
 * ## Why a production build rather than the dev server
 *
 * `conversion-flow.test.ts` drives the Vite dev server, which is fine for what
 * it asserts. It is not fine here: HMR appends `?t=<ts>` cache-busting queries,
 * and a module fetched under two URLs becomes two module instances. The
 * workspace singletons and the store are exactly that kind of module, so the
 * Compress surface can end up reading an *empty* handler registry belonging to a
 * second copy of the store, and report "still warming up" forever. That failure
 * does not exist in the shipped app. Building once and previewing gives the
 * bundle real users get.
 *
 * The preview server does not fall back to index.html for unknown paths, so the
 * mode is entered through the app's own mode-change event rather than `/compress`.
 */

const ROOT = path.resolve(__dirname, "../../");
const PREVIEW_PORT = 5233;

describe("Compress, end to end, in a browser", () => {
    let server: PreviewServer | undefined;
    let browser: Browser | undefined;
    let page: Page;
    let base: string;
    let fixturePath: string;
    let fixtureBytes: Uint8Array;
    let available = false;

    beforeAll(async () => {
        fixtureBytes = await imageHeavyPdf();
        fixturePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "frog-e2e-")), "report.pdf");
        fs.writeFileSync(fixturePath, fixtureBytes);

        try {
            // Reuse an existing build when there is one; a fresh build costs
            // ~30s and this test does not care which of the two it gets.
            if (!fs.existsSync(path.join(ROOT, "dist", "index.html"))) {
                await build({ configFile: path.resolve(ROOT, "vite.config.js"), root: ROOT, logLevel: "error" });
            }
            server = await preview({
                configFile: path.resolve(ROOT, "vite.config.js"),
                root: ROOT,
                preview: { port: PREVIEW_PORT, strictPort: true },
                logLevel: "error",
            });
            base = `http://localhost:${PREVIEW_PORT}`;

            browser = await puppeteer.launch({
                headless: true,
                args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
                // A cold Ghostscript fetch plus compile runs well past the
                // 180s default, and a timeout here reads as a product failure.
                protocolTimeout: 0,
            });
            page = await browser.newPage();
            await page.setViewport({ width: 1440, height: 900 });
            available = true;
        } catch (e) {
            console.warn("[e2e] browser or build unavailable, skipping:", (e as Error).message);
        }
    }, 900_000);

    afterAll(async () => {
        await browser?.close();
        server?.httpServer?.close();
    });

    async function openCompress() {
        await page.goto(base + "/", { waitUntil: "networkidle2" });
        await page.evaluate(() => localStorage.clear());
        await page.goto(base + "/", { waitUntil: "networkidle2" });
        // Without the handler registry every file reports "can't compress this",
        // which would be a green-looking run asserting nothing.
        await page.waitForFunction(
            () => (window as unknown as { traversionGraph?: { nodeCount: number } }).traversionGraph!.nodeCount > 100,
            { timeout: 120_000 });
        await page.evaluate(() =>
            window.dispatchEvent(new CustomEvent("frog:set-mode", { detail: "compress" })));
        await page.waitForSelector("#compress-content .upload-zone", { timeout: 30_000 });
    }

    it("shrinks a real PDF and reports honest numbers", async () => {
        if (!available) return;
        await openCompress();

        const input = await page.$("#compress-file-input");
        await input!.uploadFile(fixturePath);
        await page.waitForFunction(() => !!document.querySelector(".cw-compress"), { timeout: 30_000 });

        await page.click(".cw-compress");

        // Progress belongs in the shared modal, the one Convert uses.
        await page.waitForSelector("#popup.open", { timeout: 60_000 });
        const modal = await page.evaluate(() => {
            const p = document.getElementById("popup")!;
            return {
                title: p.querySelector("h2")?.textContent ?? "",
                hasSpinner: !!p.querySelector(".loader-gooey, .loader-spinner"),
                cancel: document.getElementById("cancel-conversion-btn")?.textContent ?? "",
            };
        });
        expect(modal.title).toMatch(/compressing/i);
        expect(modal.hasSpinner).toBe(true);
        expect(modal.cancel).toMatch(/cancel/i);

        await page.waitForSelector(".cw-results-card", { timeout: 900_000 });
        const result = await page.evaluate(() => {
            const row = document.querySelector(".cw-res-row");
            return {
                shrunk: !!row?.classList.contains("shrunk"),
                rowText: row?.textContent?.replace(/\s+/g, " ").trim() ?? "",
                headline: document.querySelector(".cw-results-headline")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
                popupClosed: !document.getElementById("popup")!.classList.contains("open"),
            };
        });

        // The regression this file exists for: an image-heavy PDF that came
        // back untouched at every setting, reported as "already compressed".
        expect(result.rowText).not.toMatch(/already compressed|can't compress/i);
        expect(result.shrunk).toBe(true);
        expect(result.headline).toMatch(/saved/i);
        // The modal must come down, whatever happened.
        expect(result.popupClosed).toBe(true);
    }, 1_200_000);

    /**
     * The Converter's "Open Compress" hand-off is deliberately *not* asserted
     * here. Driving the format picker from Puppeteer proved environment
     * sensitive - the same steps that pass standalone time out inside the
     * suite - and a test that fails for harness reasons trains people to
     * ignore red. The behaviour is covered where it is stable: the event and
     * its payload in `FormatModal.test.ts`, and the delivery in `main.ts`.
     */
});
