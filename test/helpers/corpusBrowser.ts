import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import puppeteer, { Browser, Page } from "puppeteer";

/**
 * Shared plumbing for the corpus-backed browser suites.
 *
 * Everything here was learned the expensive way while driving the built app by
 * hand, and every comment marks a round of debugging that should not have to
 * happen twice. Three suites need it (compress, convert, pdf, combined), and
 * four copies of a static file server is exactly how one of them quietly drifts
 * into testing something the others do not.
 */

const ROOT = path.resolve(__dirname, "../../");
export const DIST = path.join(ROOT, "dist");

/** A production build has to exist; these drive the bundle, not the source. */
export function distBuilt(): boolean {
    return fs.existsSync(path.join(DIST, "index.html"));
}

/**
 * `.mjs` is load-bearing and easy to miss: the Ghostscript payload is
 * dist/wasm/gs/gs.mjs, and a browser refuses a module script served with the
 * wrong MIME. Omitting it made every PDF report "failed" - indistinguishable
 * from a real compression bug, and it cost a debugging round to find.
 */
const MIME: Record<string, string> = {
    ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
    ".css": "text/css", ".json": "application/json", ".map": "application/json",
    ".wasm": "application/wasm", ".png": "image/png", ".webp": "image/webp",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff",
    ".ttf": "font/ttf", ".ico": "image/x-icon", ".txt": "text/plain",
    ".data": "application/octet-stream", ".sf2": "application/octet-stream",
};

export interface DistServer {
    port: number;
    base: string;
    close(): Promise<void>;
}

/**
 * Serves dist/ the way production does, which is fussier than it sounds.
 *
 *  - SPA fallback, so /compress and /pdf resolve (vite preview does not).
 *  - The CSP comes from the BUILT _headers. public/_headers still holds the
 *    __CSP_SCRIPT_HASHES__ placeholder, and serving that verbatim blocks every
 *    inline script.
 *  - No COOP/COEP, because netlify.toml sets none: production has no
 *    SharedArrayBuffer and ffmpeg runs its single-threaded core. Adding them
 *    would measure a path no user reaches.
 *  - Port 0, not a constant. Vitest runs test files in parallel workers, and
 *    two suites sharing a hardcoded port fail with EADDRINUSE in whichever one
 *    lost the race - a failure that reads as a broken app.
 */
export async function serveDist(): Promise<DistServer> {
    const headerFile = path.join(DIST, "_headers");
    const csp = fs.existsSync(headerFile)
        ? (fs.readFileSync(headerFile, "utf8")
            .split(/Content-Security-Policy(?:-Report-Only)?:/)[1] ?? "").split("\n")[0].trim()
        : "";

    const server = http.createServer((req, res) => {
        const url = decodeURIComponent((req.url || "/").split("?")[0]);
        let file = path.join(DIST, url);
        if (!file.startsWith(DIST)) return void res.writeHead(403).end();
        if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
        if (!fs.existsSync(file)) file = path.join(DIST, "index.html");
        res.writeHead(200, {
            "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
            "cache-control": "no-store",
            ...(csp ? { "content-security-policy": csp } : {}),
        });
        res.end(fs.readFileSync(file));
    });

    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    return {
        port,
        base: `http://localhost:${port}`,
        close: () => new Promise<void>(r => server.close(() => r())),
    };
}

export function launchBrowser(): Promise<Browser> {
    return puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        // Ghostscript on a 5 MB scan and ffmpeg on a 1080p clip both run for
        // minutes; the 180s default kills the connection mid-encode.
        protocolTimeout: 900_000,
    });
}

export interface TrackedPage {
    page: Page;
    /** CSP violations seen on this page. A CSP failure here hangs, not errors. */
    violations(): Promise<string[]>;
    /** console errors, pageerrors and failed asset fetches. */
    logs: { type: string; text: string }[];
}

/**
 * A page that records what the console said and what the policy blocked.
 *
 * Half the defects this branch found announced themselves in the console first
 * and nobody was reading it.
 */
export async function newTrackedPage(browser: Browser, downloadDir?: string): Promise<TrackedPage> {
    const page = await browser.newPage();
    const logs: { type: string; text: string }[] = [];

    await page.evaluateOnNewDocument(() => {
        (window as unknown as { __csp: string[] }).__csp = [];
        document.addEventListener("securitypolicyviolation", (e) =>
            (window as unknown as { __csp: string[] }).__csp.push(
                (e as SecurityPolicyViolationEvent).violatedDirective));
    });
    page.on("console", m => {
        const t = m.type();
        if (t === "error" || t === "warning") logs.push({ type: t, text: m.text().slice(0, 400) });
    });
    page.on("pageerror", e => logs.push({ type: "pageerror", text: String(e).slice(0, 400) }));
    page.on("requestfailed", r => {
        const f = r.failure();
        // A cancelled navigation is not a defect; a failed asset fetch is.
        if (f && !/ERR_ABORTED/.test(f.errorText)) {
            logs.push({ type: "requestfailed", text: `${r.url().slice(0, 160)} ${f.errorText}` });
        }
    });

    if (downloadDir) {
        fs.rmSync(downloadDir, { recursive: true, force: true });
        fs.mkdirSync(downloadDir, { recursive: true });
        const cdp = await page.createCDPSession();
        await cdp.send("Browser.setDownloadBehavior", {
            behavior: "allow", downloadPath: downloadDir, eventsEnabled: true,
        });
    }

    await page.setViewport({ width: 1280, height: 900 });
    return {
        page,
        logs,
        violations: () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp ?? []),
    };
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Wait for the handler registry, not for a stopwatch.
 *
 * Landing straight on a surface can beat the registry loading, and with an
 * empty option list every file fails format detection and is reported "can't
 * compress this" - which looks exactly like a compression that legitimately
 * found no gain. Two tests failed this way before this wait existed, in 4.4s,
 * which is far too fast for Ghostscript to have run at all.
 */
export async function waitForRegistry(page: Page, timeout = 60_000): Promise<void> {
    await page.waitForFunction(
        () => (window as unknown as { __formatsReady?: boolean }).__formatsReady === true
            || document.querySelectorAll("#format-options *").length > 0
            || !!document.querySelector(".cw-compress"),
        { timeout },
    );
    await sleep(2500);
}

/** Wait for a download to land and settle (no .crdownload, size stable). */
async function waitForDownload(
    dir: string,
    timeoutMs = 300_000,
): Promise<{ name: string; size: number }[] | null> {
    const start = Date.now();
    const last = new Map<string, number>();
    while (Date.now() - start < timeoutMs) {
        const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
        const done = files.filter(f => !f.endsWith(".crdownload"));
        if (done.length) {
            const stable = done.every(f => {
                const s = fs.statSync(path.join(dir, f)).size;
                const ok = last.get(f) === s && s > 0;
                last.set(f, s);
                return ok;
            });
            if (stable) return done.map(f => ({ name: f, size: fs.statSync(path.join(dir, f)).size }));
        }
        await sleep(500);
    }
    return null;
}

/**
 * Press the Download button in the shared success modal and weigh what lands.
 *
 * Every write path in both the Converter and the PDF editor ends in that modal,
 * whose footer is Download + Done. Nothing reaches disk until Download is
 * pressed - the app's own "nothing downloads until you ask" rule, and the
 * reason a harness that merely waits after the action sees no file and wrongly
 * calls it a failure.
 */
export async function takeModalDownload(
    page: Page,
    dir: string,
    timeout = 600_000,
): Promise<{ files: { name: string; size: number }[] | null; modalText: string }> {
    await page.waitForFunction(
        () => [...document.querySelectorAll(".popup-actions-footer button")]
            .some(b => /^Download/.test(b.textContent?.trim() ?? "")),
        { timeout },
    );
    const modalText = await page.evaluate(() =>
        document.querySelector("#popup")?.textContent?.replace(/\s+/g, " ").trim().slice(0, 400) ?? "");
    await page.evaluate(() => {
        [...document.querySelectorAll(".popup-actions-footer button")]
            .find(b => /^Download/.test(b.textContent?.trim() ?? ""))
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    return { files: await waitForDownload(dir, 240_000), modalText };
}

/**
 * Put files on an input by building them in the page, rather than by handing
 * Puppeteer a path.
 *
 * Needed for exactly one thing, and it is a limitation of the harness rather
 * than of the app: `uploadFile` sends the path over CDP, and a path containing
 * an astral-plane character - 🐸 is U+1F438 - fails silently. No file arrives,
 * no error is raised, and the app correctly says nothing because nothing
 * happened. Measured: the same document, with the same emoji name, constructed
 * here instead, is accepted normally ("1 file ready · 24.0 KB").
 *
 * Prefer `uploadFile` everywhere else. This skips the real file picker, so it
 * is a slightly weaker test of the same intake path.
 */
async function uploadInPage(page: Page, selector: string, paths: string[]): Promise<void> {
    const payload = paths.map(p => ({
        name: path.basename(p),
        type: path.extname(p).toLowerCase() === ".pdf" ? "application/pdf" : "",
        b64: fs.readFileSync(p).toString("base64"),
    }));
    await page.evaluate((sel, files) => {
        const dt = new DataTransfer();
        for (const f of files) {
            const bin = atob(f.b64);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            dt.items.add(new File([arr], f.name, { type: f.type }));
        }
        const input = document.querySelector<HTMLInputElement>(sel);
        if (!input) throw new Error(`no input matching ${sel}`);
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }, selector, payload);
}

/** Click the first visible button with exactly this label. */
export async function clickByText(page: Page, text: string): Promise<void> {
    const ok = await page.evaluate((t) => {
        const b = [...document.querySelectorAll("button")]
            .find(b => b.textContent?.trim() === t && b.offsetParent !== null);
        if (b) { b.click(); return true; }
        return false;
    }, text);
    if (!ok) throw new Error(`no visible button labelled "${text}"`);
}

export interface CompressRun {
    headline: string;
    rows: { name: string; shrunk: boolean; note: string; pct: string }[];
    csp: string[];
    /** Present only when a download directory was given. */
    download: { name: string; size: number }[] | null;
    /** Find a result row by the tail of its file name. */
    row(name: string): { name: string; shrunk: boolean; note: string; pct: string } | undefined;
}

/**
 * Upload, pick a level, compress, and read the per-file rows back.
 *
 * Shared because the Compress surface is both a suite of its own and the far
 * end of two hand-offs (Convert -> Compress, PDF editor -> Compress), and a
 * second copy of this would be the one that quietly stops waiting for the
 * registry.
 */
export async function runCompress(
    browser: Browser,
    base: string,
    files: string[],
    level: string,
    downloadDir?: string,
    /** Build the files in the page instead of uploading paths. See uploadInPage. */
    inPage = false,
): Promise<CompressRun> {
    const { page, violations } = await newTrackedPage(browser, downloadDir);
    await page.goto(`${base}/compress`, { waitUntil: "networkidle2", timeout: 90_000 });
    await page.waitForSelector("#compress-file-input", { timeout: 30_000 });
    if (inPage) {
        await uploadInPage(page, "#compress-file-input", files);
    } else {
        const input = await page.$("#compress-file-input");
        await input!.uploadFile(...files);
    }
    await page.waitForSelector(".cw-compress", { timeout: 30_000 });
    await page.waitForFunction(
        () => document.querySelector(".cw-compress")?.textContent?.includes("Compress"),
        { timeout: 60_000 },
    );
    await sleep(3000);

    // The level control is a modal, not a dropdown.
    await page.click(".cw-level-selector");
    await page.waitForSelector(`[data-level="${level}"]`, { timeout: 10_000 });
    await page.click(`[data-level="${level}"]`);
    await sleep(400);
    await page.click(".cw-compress");

    // Results land in the shared modal (showResultsModal), whose footer builds
    // its own buttons - `.cw-download` is dead markup.
    await page.waitForSelector(".cw-results-headline", { timeout: 600_000 });
    await sleep(1200);

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
        };
    });

    let download: { name: string; size: number }[] | null = null;
    if (downloadDir) {
        await page.evaluate(() => {
            [...document.querySelectorAll(".popup-actions-footer button")]
                .find(b => /^Download/.test(b.textContent?.trim() ?? ""))
                ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        download = await waitForDownload(downloadDir, 180_000);
    }

    const csp = await violations();
    await page.close();
    return {
        ...out, csp, download,
        row: (name: string) => out.rows.find(r => r.name.endsWith(name)),
    };
}

// --- Independent verification of PDF output -------------------------------
//
// Output is re-opened by a parser that had no part in producing it. The app's
// own report that a file is fine is not evidence: a truncated PDF came back as
// a blank page called a 99% win, and it took pdf-lib to say otherwise.

export interface PdfShape {
    pageCount: number;
    sizes: { w: number; h: number; rot: number }[];
    fields: string[];
}

export async function inspectPdf(bytes: Uint8Array | Buffer): Promise<PdfShape> {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false });
    const pages = doc.getPages();
    let fields: string[] = [];
    try { fields = doc.getForm().getFields().map(f => f.getName()); } catch { /* no AcroForm */ }
    return {
        pageCount: pages.length,
        sizes: pages.map(p => ({
            w: Math.round(p.getWidth()), h: Math.round(p.getHeight()), rot: p.getRotation().angle,
        })),
        fields,
    };
}

/**
 * Page text via pdfjs, so page ORDER can be asserted rather than page count.
 *
 * A merge that returns the right number of pages in the wrong order passes
 * every count-based check there is.
 */
export async function pdfPageTexts(bytes: Uint8Array | Buffer): Promise<string[]> {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({
        data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0,
    }).promise;
    const out: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const content = await (await doc.getPage(i)).getTextContent();
        out.push(content.items
            .map((it: { str?: string }) => it.str ?? "")
            .join(" ").replace(/\s+/g, " ").trim());
    }
    await doc.destroy();
    return out;
}
