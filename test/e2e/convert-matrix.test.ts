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
 * Runs against `dist/` without the optional browser Office engine installed.
 * The image-only Office-to-PDF cases explicitly select limited conversion.
 * Opt-in like the stale-shell suite: FROG_E2E_MATRIX=1, or `bun run test:matrix`.
 */

const RES = path.resolve(__dirname, "../resources");
const requested = process.env.FROG_E2E_MATRIX === "1";
const TMP = path.join(os.tmpdir(), "frog-convert-matrix");

type Outcome = {
    files: { name: string; size: number }[]; dir: string; modal: string; preflight: string | null;
    /** Requests to anywhere but the app's own server: a conversion must make none. */
    external: string[];
    /** Set by any script in the input that managed to run. */
    pwned: unknown;
};

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

    async function convert(input: string, target: string, opts: { noMime?: boolean } = {}): Promise<Outcome> {
        const dir = path.join(TMP, `${path.basename(input)}-to-${target}`);
        const { page } = await newTrackedPage(browser, dir);
        const external: string[] = [];
        page.on("request", r => {
            const u = r.url();
            if (!u.startsWith(server.base) && !/^(data|blob|about):/.test(u)) external.push(u);
        });
        await page.goto(`${server.base}/`, { waitUntil: "networkidle0" });
        // "All" shows data targets (CSV, JSON) that the default Core list hides.
        await page.evaluate(() => (document.querySelector('#format-mode-menu [data-value="all"]') as HTMLElement | null)?.click());
        await waitForRegistry(page);
        if (opts.noMime) {
            // A File with no type, as some drag-and-drop paths deliver one: the
            // app has only the extension to go on.
            await page.evaluate((name, b64) => {
                const bin = atob(b64);
                const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
                const dt = new DataTransfer();
                dt.items.add(new File([bytes], name));
                const el = document.querySelector<HTMLInputElement>("#file-input")!;
                el.files = dt.files;
                el.dispatchEvent(new Event("change", { bubbles: true }));
            }, path.basename(input), fs.readFileSync(input).toString("base64"));
        } else {
            const fileInput = await page.$("#file-input");
            await (fileInput as unknown as { uploadFile(p: string): Promise<void> }).uploadFile(input);
        }
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
        let preflight: string | null = null;
        if (target.toLowerCase() === "pdf" && /\.(pptx|docx|xlsx|odp|odt|ods)$/i.test(input)) {
            await page.waitForSelector("#office-limited-convert", { visible: true });
            await page.click("#office-limited-convert");
        } else {
            await page.$eval("#convert-button", b => (b as HTMLButtonElement).click());
            // HTML uses a native browser print sheet. Select the explicitly
            // labelled direct-download fallback to exercise raster output.
            if (target.toLowerCase() === "pdf" && /\.html?$/i.test(input)) {
                await page.waitForFunction(() => [...document.querySelectorAll("#popup button")]
                    .some(b => b.textContent === "Create image-based PDF instead"), { timeout: 30_000 });
                preflight = await page.$eval("#popup", el => el.textContent);
                await page.evaluate(() => {
                    const button = [...document.querySelectorAll<HTMLButtonElement>("#popup button")]
                        .find(b => b.textContent === "Create image-based PDF instead");
                    button!.click();
                });
            }
        }
        const { files, modalText } = await takeModalDownload(page, dir, 240_000);
        const pwned = await page.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned ?? null);
        await page.close();
        if (!files?.length) throw new Error(`no download; modal said: ${modalText}`);
        return { files, dir, modal: modalText, preflight, external, pwned };
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

    // #65: the head stylesheet was dropped, so a styled page came out as
    // black text on white. The body background is the cheapest proof the
    // stylesheet applied.
    it("html -> png keeps the page's stylesheet, at a fixed width and 2x", async () => {
        const o = await convert(path.join(RES, "styled-page.html"), "png");
        const UPNG = (await import("upng-js")).default;
        const png = UPNG.decode(read(o));
        expect(png.width).toBe(2048);
        const rgba = new Uint8Array(UPNG.toRGBA8(png)[0]);
        expect([...rgba.subarray(0, 3)]).toEqual([0x10, 0x20, 0x30]);
    }, 300_000);

    it("html -> pdf is A4 pages, labelled as pictures", async () => {
        const o = await convert(path.join(RES, "styled-page.html"), "pdf");
        const shape = await inspectPdf(read(o));
        expect(shape.pageCount).toBeGreaterThan(1);
        expect(shape.sizes.every(s => s.w === 595 && s.h === 842)).toBe(true);
        expect(o.modal).toMatch(/made of pictures/);
        expect(o.preflight).toMatch(/Save as PDF/);
        expect(o.modal).toMatch(/You chose an image-based PDF/);
        expect(o.modal).not.toMatch(/press Print as PDF/);
    }, 300_000);

    it("markdown -> pdf goes through HTML, not plain text, and is labelled", async () => {
        const o = await convert(path.join(RES, "markdown.md"), "pdf");
        expect(o.modal).toMatch(/made of pictures/);
        expect((await inspectPdf(read(o))).sizes[0]).toMatchObject({ w: 595, h: 842 });
    }, 300_000);

    // Inputs written to break it, kept so the bugs they found stay fixed.
    it("a hostile page converts, runs nothing and fetches nothing", async () => {
        // Scripts, event handlers, <base>, meta refresh, mutation-XSS markup,
        // and URLs to another site in src, srcset, poster, style, @import and
        // image-set. Its <video> with only a poster used to hang the
        // conversion for good: it fires neither load nor error.
        const o = await convert(path.join(RES, "hostile.html"), "pdf");
        expect(o.pwned).toBeNull();
        expect(o.external).toEqual([]);
        expect(o.preflight).toMatch(/Save as PDF/);
        expect(o.modal).toMatch(/You chose an image-based PDF/);
    }, 300_000);

    it("a table wider than the page comes through whole", async () => {
        // Its right side was cut off at the layout width.
        const o = await convert(path.join(RES, "wide-table.html"), "png");
        const UPNG = (await import("upng-js")).default;
        expect(UPNG.decode(read(o)).width).toBeGreaterThan(2048);
    }, 300_000);

    it("a .htm with no MIME type is accepted as HTML", async () => {
        // Refused as unsupported: no format declares .htm.
        const htm = path.join(TMP, "page.htm");
        fs.mkdirSync(TMP, { recursive: true });
        fs.copyFileSync(path.join(RES, "styled-page.html"), htm);
        const o = await convert(htm, "png", { noMime: true });
        expect(o.files[0].name).toMatch(/\.png$/);
    }, 300_000);

    // FFmpeg now loads only in the worker, starting when the file is added,
    // and x264 runs at a fixed preset. Both video encoders must still produce
    // a playable file through the Converter.
    it("mp4 -> webm -> mp4 still encodes, through VP8 and then x264", async () => {
        const webm = await convert(path.join(RES, "doom.mp4"), "webm");
        expect([...read(webm).subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
        // VP8 cannot be copied into MP4, so this hop re-encodes with x264.
        const webmPath = path.join(TMP, "doom.webm");
        fs.writeFileSync(webmPath, read(webm));
        const mp4 = await convert(webmPath, "mp4");
        expect(read(mp4).subarray(4, 8).toString("latin1")).toBe("ftyp");
    }, 600_000);

    it("png -> jpg is a plain success with no notice", async () => {
        const o = await convert(path.join(RES, "colors_50x50.png"), "jpeg");
        expect(read(o).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
        expect(o.modal).toMatch(/File converted!/);
        expect(o.modal).not.toMatch(/made of pictures|with limits/);
    }, 300_000);
});
