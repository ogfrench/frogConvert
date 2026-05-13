// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import puppeteer, { Browser, Page } from "puppeteer";
import { createServer, ViteDevServer } from "vite";
import path from "path";
import fs from "fs";

/** Navigate with a single retry to handle transient ERR_ABORTED from Vite dep re-optimization. */
async function safeGoto(page: Page, url: string, options?: Parameters<Page["goto"]>[1]) {
    try {
        await page.goto(url, options);
    } catch (err: any) {
        if (err.message?.includes("ERR_ABORTED")) {
            // Vite likely triggered a page reload — wait briefly and retry once
            await new Promise(r => setTimeout(r, 1000));
            await page.goto(url, options);
        } else {
            throw err;
        }
    }
}

describe("E2E Conversion Flow", () => {
    let server: ViteDevServer;
    let browser: Browser;
    let page: Page;
    let url: string;
    let browserAvailable = false;

    beforeAll(async () => {
        server = await createServer({
            configFile: path.resolve(__dirname, "../../vite.config.js"),
            root: path.resolve(__dirname, "../../"),
            server: {
                port: 0,
            }
        });
        await server.listen();
        // resolvedUrls gives the actual listening address (port: 0 picks a random port)
        url = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`;

        try {
            browser = await puppeteer.launch({
                headless: true,
                args: ["--no-sandbox", "--disable-setuid-sandbox"],
            });
            page = await browser.newPage();
            browserAvailable = true;
        } catch (err: any) {
            console.warn(`Puppeteer unavailable, E2E tests will be skipped: ${err.message}`);
        }
    }, 30000); // Server and chromium startup may take time

    afterAll(async () => {
        try { if (browser) await browser.close(); } catch { /* slow chromium teardown under full-suite load */ }
        try { if (server) await server.close(); } catch { /* ignore */ }
    }, 60000);

    beforeEach(({ skip }) => {
        if (!browserAvailable) skip();
    });

    it("loads the page and has the correct title", async () => {
        await safeGoto(page, url);
        await page.waitForSelector("#upload-zone", { timeout: 10000 });
        const title = await page.title();
        expect(title).toContain("frogConvert");
    }, 20000);

    it("has a file input available in the upload zone", async () => {
        await safeGoto(page, url);
        await page.waitForSelector("#upload-zone");

        const fileUploadTrigger = await page.$("#file-input");
        expect(fileUploadTrigger).not.toBeNull();
    });

    it("can upload a mock file, run conversion off main thread, and update UI", async () => {
        await safeGoto(page, url);
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

            // Wait for at least one format option to actually render (handlers load async;
            // a fixed timeout races the warm-cache fetch + phase-1 handler init on slow CI).
            await page.waitForFunction(() => {
                const opts = document.querySelectorAll<HTMLElement>('.format-option[data-index]');
                for (const el of opts) {
                    if (el.style.display !== "none") return true;
                }
                return false;
            }, { timeout: 15000 });

            // Click the first visible format option in a single page-side evaluation.
            // Doing the find+click via separate ElementHandle calls races the
            // format-modal re-render (handlers finish loading mid-test and re-emit
            // .format-option nodes), which detaches captured handles. Selecting
            // and clicking inside one evaluate() avoids that race.
            const clicked = await page.evaluate(() => {
                const opts = document.querySelectorAll<HTMLElement>('.format-option[data-index]');
                for (const el of opts) {
                    if (el.style.display !== "none") {
                        el.click();
                        return true;
                    }
                }
                return false;
            });
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

    it("cold-start fade does not stick body-appended elements at opacity 1", async () => {
        // Regression: the inline reveal CSS used `animation: app-fade-in forwards`
        // on every body child. `html.app-revealed` was added on boot and never
        // removed, so any element later appended to <body> (PDF Workspace mobile
        // tray, overlay, toolbar, toasts, modals) inherited the forwards-fill
        // and got stuck at opacity 1. That defeated the mobile tray's
        // opacity-based hidden state.
        //
        // The fix is a one-shot: drop `app-revealed` after the fade ends, with
        // a setTimeout fallback for prefers-reduced-motion. This test asserts
        // both halves: the class is gone after reveal, and a body-appended
        // element with an explicit opacity:0 style does NOT get overridden.
        await page.setViewport({ width: 375, height: 812 });
        await safeGoto(page, url, { waitUntil: "networkidle0", timeout: 45000 });

        // Wait for the one-shot cleanup to have run. Reveal runs on rAF after
        // CSS is applied, the fade is 0.25s, the setTimeout fallback is 350ms.
        // 5s budget covers all of that with slack for slow CI.
        await page.waitForFunction(
            () => !document.documentElement.classList.contains("app-revealed"),
            { timeout: 5000 }
        );

        const probe = await page.evaluate(() => {
            // Mimic what PdfWorkspace.ts does: append a fresh element to <body>
            // after boot, give it the same hidden-by-opacity contract as .ws-tray.
            const el = document.createElement("div");
            el.setAttribute("data-test", "post-boot-body-child");
            el.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px;opacity:0;";
            document.body.appendChild(el);
            const opacity = getComputedStyle(el).opacity;
            const animationCount = el.getAnimations().length;
            el.remove();
            return { opacity, animationCount };
        });

        expect(probe.opacity).toBe("0");
        expect(probe.animationCount).toBe(0);

        await page.setViewport({ width: 800, height: 600 });
    }, 60000);

    it("hamburger menu is visible when opened on mobile viewport", async () => {
        await page.setViewport({ width: 375, height: 667 });
        // Use networkidle0 to wait for Vite dependency re-optimization to finish
        // before interacting — otherwise a mid-test page reload loses the click state.
        await safeGoto(page, url, { waitUntil: "networkidle0", timeout: 30000 });
        await page.waitForSelector("#hamburger-btn", { visible: true });

        await page.click("#hamburger-btn");

        // Wait for the transition to complete and capture styles atomically to
        // avoid a race between waitForFunction and a follow-up $eval call.
        const handle = await page.waitForFunction(() => {
            const menu = document.querySelector("#top-controls-menu") as HTMLElement;
            if (!menu) return null;
            const styles = window.getComputedStyle(menu);
            if (styles.opacity !== "1" || styles.visibility !== "visible") return null;
            return { opacity: styles.opacity, visibility: styles.visibility };
        }, { timeout: 5000 });

        const menuStyles = await handle.jsonValue() as { opacity: string, visibility: string };
        expect(menuStyles.opacity).toBe("1");
        expect(menuStyles.visibility).toBe("visible");

        // Reset viewport for subsequent tests
        await page.setViewport({ width: 800, height: 600 });
    });
});
