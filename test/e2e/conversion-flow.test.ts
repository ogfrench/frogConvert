// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import puppeteer, { Browser, Page } from "puppeteer";
import { createServer, ViteDevServer } from "vite";
import path from "path";
import fs from "fs";

describe("E2E Conversion Flow", () => {
    let server: ViteDevServer;
    let browser: Browser;
    let page: Page;
    let url: string;

    beforeAll(async () => {
        server = await createServer({
            configFile: path.resolve(__dirname, "../../vite.config.js"),
            root: path.resolve(__dirname, "../../"),
            server: {
                port: 0,
            }
        });
        await server.listen();
        const port = server.config.server.port;
        // The base is configured to /convert/ in vite.config.js
        url = `http://localhost:${port}/convert/`;

        browser = await puppeteer.launch({ headless: true });
        page = await browser.newPage();
    }, 30000); // Server and chromium startup may take time

    afterAll(async () => {
        if (browser) await browser.close();
        if (server) await server.close();
    });

    it("loads the page and has the correct title", async () => {
        await page.goto(url);
        await page.waitForSelector("#upload-zone", { timeout: 10000 });
        const title = await page.title();
        expect(title).toContain("frogConvert");
    }, 20000);

    it("has a file input available in the upload zone", async () => {
        await page.goto(url);
        await page.waitForSelector("#upload-zone");

        const fileUploadTrigger = await page.$("#file-input");
        expect(fileUploadTrigger).not.toBeNull();
    });

    it("can upload a mock file, run conversion off main thread, and update UI", async () => {
        await page.goto(url);
        await page.waitForSelector("#file-input");

        const dummyPath = path.join(__dirname, "dummy.png");
        const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
        fs.writeFileSync(dummyPath, Buffer.from(b64, 'base64'));

        try {
            const fileInput = await page.$("input#file-input") as puppeteer.ElementHandle<HTMLInputElement>;
            if (fileInput) {
                await fileInput.uploadFile(dummyPath);
            }

            // Wait for format selector to be active
            await page.waitForSelector("#format-selector", { visible: true });
            await page.click("#format-selector");

            // Choose HTML format
            await page.waitForSelector("#format-modal", { visible: true });

            // No need to search, just wait a bit for rendering
            await new Promise(r => setTimeout(r, 300));

            // Click the first visible format option
            const formatOptions = await page.$$('.format-option[data-index]');
            let clicked = false;
            for (const opt of formatOptions) {
                const isVisible = await page.evaluate(el => el.style.display !== "none", opt);
                if (isVisible) {
                    await opt.click();
                    clicked = true;
                    break;
                }
            }
            expect(clicked).toBe(true);

            // Wait for modal to close
            await page.waitForFunction(() => {
                const modal = document.querySelector("#format-modal") as HTMLElement;
                return !modal || !modal.classList.contains("open");
            });

            // Click convert (use evaluate to bypass pointer-events or overlap issues)
            await page.$eval("#convert-button", el => (el as HTMLButtonElement).click());

            // Wait for conversion to finish (the modal goes away and we should see a download button OR popup closes)
            await page.waitForFunction(() => {
                const popup = document.querySelector("#popup-box") as HTMLElement;
                return !popup || popup.style.display === "none";
            }, { timeout: 30000 }); // Wait up to 30s for conversion

            // There should be a download all button now or the files-list is populated
            const fileList = await page.$("#files-list");
            const childrenLength = await page.evaluate(el => el?.children.length, fileList);
            expect(childrenLength).toBe(0); // Files are cleared after successful conversion

        } finally {
            if (fs.existsSync(dummyPath)) fs.unlinkSync(dummyPath);
        }
    }, 45000);

    it("hamburger menu is visible when opened on mobile viewport", async () => {
        await page.setViewport({ width: 375, height: 667 });
        await page.goto(url);
        await page.waitForSelector("#hamburger-btn", { visible: true });

        await page.click("#hamburger-btn");

        // Wait for the menu-open class to be applied and transition to complete
        await page.waitForFunction(() => {
            const menu = document.querySelector("#top-controls-menu") as HTMLElement;
            if (!menu) return false;
            const styles = window.getComputedStyle(menu);
            return styles.opacity === "1" && styles.visibility === "visible";
        }, { timeout: 5000 });

        const menuStyles = await page.$eval("#top-controls-menu", el => {
            const styles = window.getComputedStyle(el);
            return { opacity: styles.opacity, visibility: styles.visibility };
        });

        expect(menuStyles.opacity).toBe("1");
        expect(menuStyles.visibility).toBe("visible");

        // Reset viewport for subsequent tests
        await page.setViewport({ width: 800, height: 600 });
    });
});
