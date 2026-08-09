// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import puppeteer, { Browser, Page } from "puppeteer";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { corpusFile, hasCorpus, reportCorpusSkips, CORPUS_REASON } from "../helpers/corpus.ts";

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

const ROOT = path.resolve(__dirname, "../../");
const DIST = path.join(ROOT, "dist");
const PORT = 4321;

const NEEDED = [
    "pdf/paper.pdf",
    "pdf/large-text.pdf",
    "pdf/password.pdf",
    "image/photo-mobile.jpg",
    "adversarial/truncated.pdf",
    "adversarial/zero.pdf",
];

/**
 * Serves dist/ the way production does, which is fussier than it sounds.
 *
 *  - SPA fallback, so /compress resolves (vite preview does not do this).
 *  - The CSP comes from the BUILT _headers. public/_headers still holds the
 *    __CSP_SCRIPT_HASHES__ placeholder, and serving that verbatim blocks every
 *    inline script.
 *  - No COOP/COEP, because netlify.toml sets none: production has no
 *    SharedArrayBuffer and ffmpeg runs its single-threaded core. Adding them
 *    would measure a path no user reaches.
 */
function serveDist(): http.Server {
    const headerFile = path.join(DIST, "_headers");
    const csp = fs.existsSync(headerFile)
        ? (fs.readFileSync(headerFile, "utf8").split(/Content-Security-Policy(?:-Report-Only)?:/)[1] ?? "").split("\n")[0].trim()
        : "";
    // `.mjs` is load-bearing and easy to miss: the Ghostscript payload is
    // dist/wasm/gs/gs.mjs, and a browser refuses a module script served with the
    // wrong MIME. Omitting it made every PDF report "failed" - indistinguishable
    // from a real compression bug, and it cost a debugging round to find.
    const types: Record<string, string> = {
        ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
        ".css": "text/css", ".json": "application/json", ".map": "application/json",
        ".wasm": "application/wasm", ".png": "image/png", ".webp": "image/webp",
        ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff",
        ".ttf": "font/ttf", ".ico": "image/x-icon", ".txt": "text/plain",
        ".data": "application/octet-stream", ".sf2": "application/octet-stream",
    };
    return http.createServer((req, res) => {
        const url = decodeURIComponent((req.url || "/").split("?")[0]);
        let file = path.join(DIST, url);
        if (!file.startsWith(DIST)) return void res.writeHead(403).end();
        if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
        if (!fs.existsSync(file)) file = path.join(DIST, "index.html");
        res.writeHead(200, {
            "content-type": types[path.extname(file)] || "application/octet-stream",
            "cache-control": "no-store",
            ...(csp ? { "content-security-policy": csp } : {}),
        });
        res.end(fs.readFileSync(file));
    }).listen(PORT);
}

const ready = hasCorpus(...NEEDED) && fs.existsSync(path.join(DIST, "index.html"));

describe.skipIf(!ready)(`Compress against the real corpus [${CORPUS_REASON}]`, () => {
    let server: http.Server;
    let browser: Browser;
    let page: Page;
    let violations: string[] = [];

    beforeAll(async () => {
        server = serveDist();
        browser = await puppeteer.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
            protocolTimeout: 900_000,
        });
    }, 180_000);

    afterAll(async () => {
        try { await browser?.close(); } catch { /* slow teardown */ }
        await new Promise<void>(r => server?.close(() => r()));
        reportCorpusSkips();
    }, 60_000);

    /** Upload, pick a level, compress, and read the per-file rows back. */
    async function run(files: string[], level: string) {
        page = await browser.newPage();
        violations = [];
        await page.evaluateOnNewDocument(() => {
            (window as never as { __csp: string[] }).__csp = [];
            document.addEventListener("securitypolicyviolation", (e) =>
                (window as never as { __csp: string[] }).__csp.push(e.violatedDirective));
        });
        await page.setViewport({ width: 1280, height: 900 });
        await page.goto(`http://localhost:${PORT}/compress`, { waitUntil: "networkidle2", timeout: 90_000 });
        await page.waitForSelector("#compress-file-input", { timeout: 30_000 });
        const input = await page.$("#compress-file-input");
        await input!.uploadFile(...files);
        await page.waitForSelector(".cw-compress", { timeout: 30_000 });

        // Wait for the handler registry, not for a stopwatch. Landing straight
        // on /compress can beat it loading, and with an empty option list every
        // file fails format detection and is reported "can't compress this" -
        // which looks exactly like a compression that legitimately found no
        // gain. Two tests failed this way before the wait was added, in 4.4s,
        // which is far too fast for Ghostscript to have run at all.
        await page.waitForFunction(
            () => document.querySelector(".cw-compress")?.textContent?.includes("Compress"),
            { timeout: 60_000 },
        );
        await new Promise(r => setTimeout(r, 3000));

        // The level control is a modal, not a dropdown.
        await page.click(".cw-level-selector");
        await page.waitForSelector(`[data-level="${level}"]`, { timeout: 10_000 });
        await page.click(`[data-level="${level}"]`);
        await new Promise(r => setTimeout(r, 400));
        await page.click(".cw-compress");

        // Results land in the shared modal (showResultsModal), whose footer
        // builds its own buttons - `.cw-download` is dead markup.
        await page.waitForSelector(".cw-results-headline", { timeout: 600_000 });
        await new Promise(r => setTimeout(r, 1200));

        const out = await page.evaluate(() => {
            const txt = (el: Element | null) => el?.textContent?.trim().replace(/\s+/g, " ") ?? "";
            return {
                headline: txt(document.querySelector(".cw-results-headline")),
                rows: [...document.querySelectorAll(".cw-res-row")].map(r => ({
                    name: r.querySelector(".cw-row-name")?.getAttribute("title") ?? "",
                    shrunk: r.classList.contains("shrunk"),
                    note: txt(r.querySelector(".cw-res-note")),
                    pct: txt(r.querySelector(".cw-res-pct")),
                })),
                csp: (window as never as { __csp: string[] }).__csp,
            };
        });
        violations = out.csp;
        await page.close();
        return out;
    }

    const row = (r: Awaited<ReturnType<typeof run>>, name: string) =>
        r.rows.find(x => x.name.endsWith(name));

    it("empties nothing: a password-protected PDF is refused, not reported as a saving", async () => {
        const r = await run([corpusFile("pdf/password.pdf")!, corpusFile("pdf/paper.pdf")!], "auto");
        const pw = row(r, "password.pdf");
        expect(pw, "password.pdf missing from the results").toBeDefined();
        expect(pw!.shrunk, "an encrypted PDF must never report a saving").toBe(false);
        expect(pw!.note).toMatch(/failed/i);
        // The ordinary file in the same batch still works.
        expect(row(r, "paper.pdf")!.shrunk).toBe(true);
    }, 900_000);

    it("does not refuse a long text PDF at Automatic", async () => {
        const r = await run([corpusFile("pdf/large-text.pdf")!], "auto");
        const doc = row(r, "large-text.pdf");
        expect(doc!.shrunk, "Automatic used to hand this back as 'already compressed'").toBe(true);
        // Measured -65%; assert the shape, not the exact figure, so a Ghostscript
        // bump does not fail a test about behaviour.
        expect(parseInt(doc!.pct.replace(/\D/g, ""), 10)).toBeGreaterThan(40);
    }, 900_000);

    it("refuses damaged and empty files instead of inventing a win", async () => {
        const r = await run([corpusFile("adversarial/truncated.pdf")!, corpusFile("adversarial/zero.pdf")!], "auto");
        expect(row(r, "truncated.pdf")!.shrunk).toBe(false);
        expect(row(r, "truncated.pdf")!.note).toMatch(/failed/i);
        const zero = row(r, "zero.pdf")!;
        expect(zero.shrunk).toBe(false);
        // An empty file is not "already compressed" - there is nothing in it.
        expect(zero.note).not.toMatch(/already/i);
    }, 900_000);

    it("compresses a real photo substantially", async () => {
        const r = await run([corpusFile("image/photo-mobile.jpg")!], "auto");
        const img = row(r, "photo-mobile.jpg")!;
        expect(img.shrunk).toBe(true);
        expect(parseInt(img.pct.replace(/\D/g, ""), 10)).toBeGreaterThan(50);
    }, 900_000);

    it("raises no CSP violations, which would hang rather than error", () => {
        expect(violations).toEqual([]);
    });
});
