// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
// `puppeteer`, not `puppeteer-core`: only the former is a declared dependency,
// and connect() over an existing DevTools endpoint needs nothing core-specific.
import puppeteer, { type Browser, type Page } from "puppeteer";
import { spawn, type ChildProcess } from "child_process";
import { build } from "vite";
import fs from "fs";
import os from "os";
import path from "path";
import { hasFullRegistry, MISSING_DEPS_REASON } from "../helpers/optionalDeps.ts";

/**
 * The desktop shell, actually launched.
 *
 * Everything else in this suite exercises the app over http://. The Electron
 * build serves it over a custom `app://` protocol with its own hand-written
 * route fallback, its own COOP/COEP header injection and its own file
 * resolution - none of which any other test touches. `app://-/compress`
 * answered "File Not Found" all the way to release sign-off because nothing
 * had ever opened the built artifact.
 *
 * Runs headless via Xvfb. Skips - loudly, with the reason - where either the
 * Electron binary or a virtual framebuffer is missing, because a silent
 * `return` is how the compress e2e stayed red in CI for four runs.
 */
const ROOT = path.resolve(__dirname, "../..");
const ELECTRON_BIN = path.join(ROOT, "node_modules/electron/dist/electron");

function which(cmd: string): boolean {
    const dirs = (process.env.PATH ?? "").split(path.delimiter);
    return dirs.some(d => d && fs.existsSync(path.join(d, cmd)));
}

const hasElectron = fs.existsSync(ELECTRON_BIN);
const hasXvfb = which("xvfb-run");
const canRun = hasElectron && hasXvfb && hasFullRegistry;
// Only ever a *reason to skip*. Written as a plain fallthrough it labelled a
// perfectly good run "[xvfb-run not on PATH]", which reads as a skipped suite
// to anyone scanning CI output.
const WHY = canRun ? "runs here"
    : !hasFullRegistry ? MISSING_DEPS_REASON
    : !hasElectron ? "electron binary not installed (run `npm rebuild electron`)"
    : "xvfb-run not on PATH";

describe.skipIf(!canRun)(`Electron desktop app [${WHY}]`, () => {
    let proc: ChildProcess;
    let browser: Browser;
    let page: Page;

    beforeAll(async () => {
        // The desktop bundle differs from the web one, and vite.config.js reads
        // the flag from the environment at config-load time - so it has to be
        // set before build(), not passed in as a define.
        process.env.IS_DESKTOP = "true";
        await build({
            configFile: path.resolve(ROOT, "vite.config.js"),
            root: ROOT,
            logLevel: "error",
        });

        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "frog-electron-"));
        proc = spawn("xvfb-run", [
            "-a", "--server-args=-screen 0 1280x800x24",
            ELECTRON_BIN, "--no-sandbox",
            `--user-data-dir=${profile}`,
            // Port 0, and read back what Chromium chose. A fixed port is a
            // shared resource: an Electron left behind by an earlier run - CI
            // logs "Terminate orphan process: (electron)" on the way out - is
            // still holding it, and `connect` would attach to THAT browser and
            // drive somebody else's window. Chromium writes the assigned port
            // to DevToolsActivePort in the profile directory, which is a fresh
            // temp dir per run, so there is nothing to collide with.
            "--remote-debugging-port=0", ".",
        ], { cwd: ROOT, stdio: "ignore", detached: true });

        const portFile = path.join(profile, "DevToolsActivePort");
        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

        // Phase 1: the endpoint. Polled rather than slept on.
        const endpointBy = Date.now() + 120_000;
        let port = 0;
        for (;;) {
            // First line is the port, second the browser's WS path.
            if (fs.existsSync(portFile)) {
                const first = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
                if (first && Number(first) > 0) { port = Number(first); break; }
            }
            if (Date.now() > endpointBy) {
                throw new Error(`Electron never wrote ${portFile}; it did not start.`);
            }
            await sleep(250);
        }

        const connectBy = Date.now() + 120_000;
        for (;;) {
            try {
                browser = await puppeteer.connect({
                    browserURL: `http://127.0.0.1:${port}`,
                    defaultViewport: null,
                });
                break;
            } catch (err) {
                if (Date.now() > connectBy) throw err;
                await sleep(1000);
            }
        }

        // Phase 2: a window to actually drive.
        //
        // These are two separate events and the gap between them is wide.
        // Measured here: DevToolsActivePort appears about a second after spawn,
        // while the BrowserWindow takes appreciably longer - the main process
        // opens the endpoint before it creates anything to look at. Taking
        // `pages()[0]` straight after connecting therefore reads `undefined`
        // whenever the machine is busy enough, and every test in the file then
        // dies on `Cannot read properties of undefined (reading 'goto')`, which
        // names neither the missing window nor the race that lost it. That is
        // exactly how this suite went red in CI while passing locally.
        const windowBy = Date.now() + 120_000;
        for (;;) {
            const pages = await browser.pages();
            if (pages.length > 0) { page = pages[0]; break; }
            if (Date.now() > windowBy) {
                throw new Error(
                    "Electron opened its DevTools endpoint but never created a window " +
                    "within 120s. The app started and its main process did not get as " +
                    "far as a BrowserWindow - check src/electron.cjs, not this test.",
                );
            }
            await sleep(500);
        }
    }, 600_000);

    afterAll(async () => {
        await browser?.disconnect();
        try { if (proc?.pid) process.kill(-proc.pid); } catch { /* already gone */ }
    });

    /** Load a route and wait for the app to actually mount on it. */
    async function open(route: string) {
        await page.goto(`app://-/${route}`, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(
            () => document.body.innerText.length > 20,
            { timeout: 60_000 });
    }

    it("serves the SPA on every route the router can produce", async () => {
        for (const route of ["convert", "pdf", "compress"]) {
            await open(route);
            const text = await page.evaluate(() => document.body.innerText);
            expect(text, `app://-/${route} should not 404`).not.toMatch(/File Not Found/i);
        }
    }, 300_000);

    it("lands a deep link on the surface it names", async () => {
        await open("compress");
        const visible = await page.waitForFunction(
            () => {
                const card = document.querySelector("#compress-card");
                return !!card && card.getBoundingClientRect().width > 0;
            },
            { timeout: 60_000 }).catch(() => null);
        expect(visible, "app://-/compress should show the compress card").toBeTruthy();
    }, 300_000);

    it("still serves real assets from disk instead of rewriting them", async () => {
        await open("compress");
        const res = await page.evaluate(async () => {
            const r = await fetch("app://-/cache.json");
            const t = await r.text();
            return { status: r.status, looksLikeJson: /^[[{]/.test(t.trim()), length: t.length };
        });
        expect(res.status).toBe(200);
        expect(res.looksLikeJson, "cache.json must not be rewritten to index.html").toBe(true);
        expect(res.length).toBeGreaterThan(1000);
    }, 120_000);

    it("keeps the primary action a full-width, 44px target inside the shell", async () => {
        await open("compress");
        await page.setViewport({ width: 1280, height: 800 });

        // A real file through the real picker - the app builds its input
        // lazily, so a synthesised change event does not register.
        const jpeg = path.join(os.tmpdir(), `frog-e2e-${Date.now()}.jpg`);
        fs.writeFileSync(jpeg, Buffer.from(await page.evaluate(async () => {
            const c = document.createElement("canvas");
            c.width = 1200; c.height = 800;
            const g = c.getContext("2d")!;
            const grad = g.createLinearGradient(0, 0, 1200, 800);
            grad.addColorStop(0, "#2b6cb0"); grad.addColorStop(1, "#f6ad55");
            g.fillStyle = grad; g.fillRect(0, 0, 1200, 800);
            for (let i = 0; i < 3000; i++) {
                g.fillStyle = `rgba(${(i * 37) % 255},${(i * 91) % 255},${(i * 53) % 255},0.5)`;
                g.fillRect((i * 137) % 1200, (i * 71) % 800, 12, 12);
            }
            return c.toDataURL("image/jpeg", 0.98).split(",")[1];
        }), "base64"));

        const [chooser] = await Promise.all([
            page.waitForFileChooser({ timeout: 30_000 }),
            page.evaluate(() =>
                (document.querySelector("#compress-card .upload-zone") as HTMLElement).click()),
        ]);
        await chooser.accept([jpeg]);

        await page.waitForFunction(() => !!document.querySelector(".cw-compress"), { timeout: 60_000 });
        const geom = await page.evaluate(() => {
            // `offsetHeight`/`clientWidth`, not `getBoundingClientRect()`. The
            // card carries an entrance animation whose transform scales the
            // *painted* box, so a rect read mid-animation reported the 44px
            // button as 43.36 and failed a rule that was being obeyed. The
            // assertion is about CSS sizing, so measure the layout box, which
            // no transform touches.
            const btn = document.querySelector(".cw-compress") as HTMLElement;
            const card = document.querySelector("#compress-card") as HTMLElement;
            const cs = getComputedStyle(card);
            const inner = card.clientWidth
                - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
            return { w: btn.offsetWidth, h: btn.offsetHeight, inner };
        });

        expect(geom.h).toBeGreaterThanOrEqual(44);
        // Within a couple of px of the card's content box - it is `width: 100%`,
        // so anything else means a stray margin or a border eating the row.
        expect(Math.abs(geom.inner - geom.w)).toBeLessThanOrEqual(2);

        fs.rmSync(jpeg, { force: true });
    }, 600_000);
    it("converts Office files through an installed LibreOffice", async () => {
        // The desktop app answers app://-/api/health and /api/convert itself
        // (src/electron-office.cjs), which turns on the libreoffice handler's
        // remote mode. Without it, desktop Office -> PDF drew the document as
        // one picture even with LibreOffice installed.
        await open("convert");
        const health = await page.evaluate(async () => (await fetch("/api/health")).json());
        const installed = health.handlers.includes("libreoffice");
        if (!installed) return; // runner without LibreOffice: health says so, nothing to convert

        await page.waitForFunction(
            () => ((window as unknown as { supportedFormatCache?: Map<string, unknown[]> })
                .supportedFormatCache?.get("libreoffice")?.length ?? 0) > 0,
            { timeout: 60_000 },
        );
        const deck = fs.readFileSync(path.join(ROOT, "test/resources/deck.pptx")).toString("base64");
        const out = await page.evaluate(async (b64) => {
            const r = await fetch("/api/convert", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fileName: "deck.pptx", base64Bytes: b64, outputExt: "pdf" }),
            });
            return { status: r.status, body: await r.json() };
        }, deck);
        expect(out.status).toBe(200);
        const pdf = Buffer.from(out.body[0].base64Bytes, "base64");
        const { PDFDocument } = await import("pdf-lib");
        expect((await PDFDocument.load(pdf)).getPageCount()).toBe(4);
    }, 300_000);

    it("prints HTML to a PDF with real text, and keeps the page off the disk", async () => {
        // src/electron-print.cjs: Chromium's own PDF printer, so the text is
        // selectable. A browser can only draw the page as pictures.
        await open("convert");
        const html = "<!doctype html><html><head><style>h1{color:#1f6f43}</style></head>" +
            "<body><h1>Hello frog</h1><img src=\"../../../../etc/hostname\">" +
            "<p>" + "Words on a page. ".repeat(2000) + "</p></body></html>";
        const out = await page.evaluate(async (h) => {
            const r = await fetch("/api/html-to-pdf", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ html: h }),
            });
            return { status: r.status, body: await r.json() };
        }, html);
        expect(out.status).toBe(200);
        const pdf = Buffer.from(out.body.base64Bytes, "base64");
        const { PDFDocument } = await import("pdf-lib");
        const doc = await PDFDocument.load(pdf);
        expect(doc.getPageCount()).toBeGreaterThan(1);
        const { width, height } = doc.getPage(0).getSize();
        // A4; Chromium rounds it to whole device units (595.9 x 842.9).
        expect(Math.abs(width - 595.28)).toBeLessThan(2);
        expect(Math.abs(height - 841.89)).toBeLessThan(2);
        const { pdfPageTexts } = await import("../helpers/corpusBrowser.ts");
        expect((await pdfPageTexts(pdf))[0]).toMatch(/Hello frog/);
    }, 120_000);

    it("converts an HTML file to a real PDF from the Converter", async () => {
        await open("convert");
        const file = path.join(os.tmpdir(), `frog-e2e-${Date.now()}.html`);
        fs.writeFileSync(file, "<!doctype html><html><head><style>h1{color:#1f6f43}</style></head><body><h1>Hello frog</h1></body></html>");
        const input = await page.waitForSelector("#file-input");
        await (input as unknown as { uploadFile(p: string): Promise<void> }).uploadFile(file);
        await page.waitForSelector("#format-selector", { visible: true });
        await page.click("#format-selector");
        await page.waitForSelector("#format-modal.open");
        await page.waitForFunction(() => [...document.querySelectorAll(".format-option")]
            .some(o => /^PDF\b/.test(o.textContent?.trim() ?? "") && !o.classList.contains("unavailable")), { timeout: 60_000 });
        await page.evaluate(() => ([...document.querySelectorAll<HTMLElement>(".format-option")]
            .find(o => /^PDF\b/.test(o.textContent?.trim() ?? "") && !o.classList.contains("unavailable")))!.click());
        await page.$eval("#convert-button", b => (b as HTMLButtonElement).click());
        // The result modal: Download on success, Got it on failure.
        const modal = await page.waitForFunction(() => {
            const done = [...document.querySelectorAll("#popup button")]
                .some(b => /^(Download|Got it)/.test(b.textContent?.trim() ?? ""));
            return done ? document.querySelector("#popup")!.textContent!.replace(/\s+/g, " ") : null;
        }, { timeout: 120_000 }).then(h => h.jsonValue());
        expect(modal).toMatch(/File converted!/);
        expect(modal).not.toMatch(/made of pictures|with limits/);
        fs.rmSync(file, { force: true });
    }, 300_000);
});
