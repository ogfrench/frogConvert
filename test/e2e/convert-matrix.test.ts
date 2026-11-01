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

        }
        const { files, modalText } = await takeModalDownload(page, dir, 240_000);
        const pwned = await page.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned ?? null);
        await page.close();
        if (!files?.length) throw new Error(`no download; modal said: ${modalText}`);
        return { files, dir, modal: modalText, preflight, external, pwned };
    }

    const read = (o: Outcome) => fs.readFileSync(path.join(o.dir, o.files[0].name));

    it("searches across tiers without changing the selected Core mode", async () => {
        const { page } = await newTrackedPage(browser, path.join(TMP, "global-search"));
        try {
            await page.goto(`${server.base}/`, { waitUntil: "networkidle0" });
            await waitForRegistry(page);
            await page.evaluate(() => {
                (document.querySelector('#format-mode-menu [data-value="core"]') as HTMLElement).click();
            });
            const listed = () => page.$$eval(".format-option", els => els.map(el => el.textContent ?? ""));
            const coreList = await listed();
            expect(coreList.some(t => t.startsWith("XLSX"))).toBe(false);

            await page.click("#format-selector");
            // Opening must put the cursor in search: the visibility transition
            // used to leave the modal unfocusable when focus() ran (#107).
            expect(await page.evaluate(() => document.activeElement?.id)).toBe("format-search");
            // Real keystrokes, no programmatic focus: they land wherever the user's would.
            await page.keyboard.type("xlsx");
            await page.waitForFunction(() => !!document.querySelector(".format-option .format-tier-tag"));
            const matching = await page.evaluate(() => {
                const button = [...document.querySelectorAll<HTMLButtonElement>(".format-option")]
                    .find(el => el.textContent?.startsWith("XLSX"));
                return {
                    tier: button?.querySelector(".format-tier-tag")?.textContent,
                    mode: localStorage.getItem("formatMode"),
                };
            });
            expect(matching.tier).toBe("Core+");
            expect(matching.mode).toBe("core");

            // Keyboard: ArrowDown from search reaches the first result.
            await page.keyboard.press("ArrowDown");
            expect(await page.evaluate(() => document.activeElement?.textContent?.startsWith("XLSX"))).toBe(true);

            // Clearing the query restores the Core list exactly, not the search results.
            await page.focus("#format-search");
            await page.$eval("#format-search", el => {
                const input = el as HTMLInputElement;
                input.value = "";
                input.dispatchEvent(new Event("input", { bubbles: true }));
            });
            await page.waitForFunction(() => !document.querySelector(".format-tier-tag"));
            expect(await listed()).toEqual(coreList);
            expect(await page.evaluate(() => localStorage.getItem("formatMode"))).toBe("core");
        } finally {
            await page.close();
        }
    }, 120_000);

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

    it("pptx -> html carries every slide's text, in order, from a real deck", async () => {
        const o = await convert(path.join(RES, "deck.pptx"), "html");
        const html = read(o).toString("utf8");
        const text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
        let at = 0;
        // "South" is a table cell: only the preferred Pandoc route keeps tables.
        for (const expected of ["Quarterly Review", "Revenue up 12%", "Numbers", "South", "Picture slide"]) {
            at = text.indexOf(expected, at);
            expect(at, `"${expected}" missing or out of order`).toBeGreaterThanOrEqual(0);
        }
        expect(html).not.toMatch(/<script\b/i);
        expect(o.external).toEqual([]);
        expect(o.pwned).toBeNull();
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

    it.each([
        ["styled-page.html", false], ["hostile.html", false], ["styled-page.html", true],
    ] as const)("%s offers private native PDF export (retry: %s)", async (fixture, failOnce) => {
        const dir = path.join(TMP, "html-native-print");
        const { page } = await newTrackedPage(browser, dir);
        const external: string[] = [];
        page.on("request", r => {
            if (!r.url().startsWith(server.base) && !/^(data|blob|about):/.test(r.url())) external.push(r.url());
        });
        try {
            await page.goto(`${server.base}/`, { waitUntil: "networkidle0" });
            await page.evaluate(() => (document.querySelector('#format-mode-menu [data-value="all"]') as HTMLElement | null)?.click());
            await waitForRegistry(page);
            const input = await page.$("#file-input");
            await (input as unknown as { uploadFile(p: string): Promise<void> }).uploadFile(path.join(RES, fixture));
            await page.click("#format-selector");
            await page.waitForSelector("#format-modal.open");
            await sleep(800);
            const picked = await page.evaluate(() => {
                const option = [...document.querySelectorAll<HTMLElement>(".format-option")]
                    .find(o => /^PDF\b/i.test(o.textContent?.trim() ?? "") && !o.classList.contains("unavailable"));
                option?.click();
                return !!option;
            });
            expect(picked).toBe(true);
            await sleep(600);
            if (failOnce) {
                await page.evaluate(() => {
                    const create = document.createElement.bind(document);
                    let failed = false;
                    document.createElement = ((tag: string, options?: ElementCreationOptions) => {
                        if (tag === "iframe" && !failed) {
                            failed = true;
                            throw new Error("Injected preparation failure");
                        }
                        return create(tag, options);
                    }) as typeof document.createElement;
                });
            }
            await page.click("#convert-button");
            if (failOnce) {
                await page.waitForFunction(() => document.querySelector("#popup h2")?.textContent === "PDF options unavailable");
                expect(await page.$eval("#popup", el => el.textContent)).not.toMatch(/picture-only/i);
                await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("#popup button")]
                    .find(b => b.textContent === "Try again")!.click());
            }
            await page.waitForFunction(() => [...document.querySelectorAll("#popup button")]
                .some(b => b.textContent === "Save PDF"), { timeout: 30_000 });
            const ready = await page.evaluate(() => {
                const frame = document.querySelector<HTMLIFrameElement>('iframe[sandbox="allow-same-origin allow-modals"]');
                const policy = frame?.contentDocument?.querySelector('meta[http-equiv="Content-Security-Policy"]');
                const button = [...document.querySelectorAll<HTMLButtonElement>("#popup button")]
                    .find(b => b.textContent === "Save PDF");
                if (button) button.id = "native-print-test";
                if (frame?.contentWindow) {
                    Object.defineProperty(frame.contentWindow, "print", {
                        configurable: true,
                        value: () => { (window as unknown as { __nativePrintTest?: boolean }).__nativePrintTest = true; },
                    });
                }
                return { hasFrame: !!frame, csp: policy?.getAttribute("content"), title: document.querySelector("#popup h2")?.textContent };
            });
            expect(ready.hasFrame).toBe(true);
            expect(ready.csp).toContain("default-src 'none'");
            expect(ready.title).toBe("Save as PDF");
            const alignment = await page.$eval("#popup .html-pdf-export-notice", el => ({
                text: getComputedStyle(el).textAlign,
                steps: getComputedStyle(el.querySelector(".convert-notice-text")!).whiteSpace,
                hasFallback: !!el.querySelector(".convert-notice-link"),
                instructions: el.querySelector(".convert-notice-text")?.textContent,
            }));
            expect(alignment).toMatchObject({ text: "center", steps: "pre-line", hasFallback: false });
            expect(alignment.instructions).toContain('choose "Save as PDF" as the printer or destination, then press Save.');
            await page.click("#native-print-test");
            expect(await page.evaluate(() => (window as unknown as { __nativePrintTest?: boolean }).__nativePrintTest)).toBe(true);
            expect(await page.$eval("#popup h2", el => el.textContent)).toBe("Save as PDF");
            // Short phone viewports must still allow scrolling down to Done.
            await page.setViewport({ width: 320, height: 568 });
            const closeReachable = await page.evaluate(() => {
                const popup = document.querySelector<HTMLElement>("#popup")!;
                popup.scrollTop = popup.scrollHeight;
                const done = [...popup.querySelectorAll("button")].find(b => b.textContent === "Done")!;
                const rect = done.getBoundingClientRect();
                return rect.top >= 0 && rect.bottom <= window.innerHeight;
            });
            expect(closeReachable).toBe(true);
            expect(external).toEqual([]);
            expect(await page.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned ?? null)).toBeNull();
        } finally {
            await page.close();
        }
    }, 300_000);

    it("markdown -> pdf goes through HTML, not plain text, and is labelled", async () => {
        const o = await convert(path.join(RES, "markdown.md"), "pdf");
        expect(o.modal).toMatch(/made of pictures/);
        expect((await inspectPdf(read(o))).sizes[0]).toMatchObject({ w: 595, h: 842 });
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

    it("round-trips both advertised Aseprite formats through the browser engine", async () => {
        const original = fs.readFileSync(path.join(RES, "colors_50x50.png"));
        const page = await browser.newPage();
        const pixels = async (bytes: Buffer) => page.evaluate(async (b64) => {
            const raw = atob(b64);
            const data = Uint8Array.from(raw, c => c.charCodeAt(0));
            const image = await createImageBitmap(new Blob([data], { type: "image/png" }));
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext("2d")!;
            context.drawImage(image, 0, 0);
            return { width: image.width, height: image.height, pixels: Array.from(context.getImageData(0, 0, image.width, image.height).data) };
        }, bytes.toString("base64"));
        try {
            const expected = await pixels(original);
            for (const target of ["ase", "aseprite"]) {
                const encoded = await convert(path.join(RES, "colors_50x50.png"), target);
                expect(read(encoded).readUInt16LE(4)).toBe(0xa5e0);
                const decoded = await convert(path.join(encoded.dir, encoded.files[0].name), "png");
                expect(await pixels(read(decoded))).toEqual(expected);
                expect([...encoded.external, ...decoded.external]).toEqual([]);
            }
        } finally {
            await page.close();
        }
    }, 600_000);

    it("reads a classic Amiga Workbench icon as PNG", async () => {
        // A one-pixel classic DiskObject with one opaque white planar pixel.
        const icon = Buffer.alloc(101);
        icon.writeUInt16BE(0xe310, 0);
        icon.writeUInt32BE(1, 22); // gadget render pointer present
        icon.writeUInt16BE(1, 82); // width
        icon.writeUInt16BE(1, 84); // height
        icon.writeUInt16BE(1, 86); // depth
        icon[92] = 1; // use bitplane zero
        icon[98] = 0x80; // first pixel uses palette entry one
        fs.mkdirSync(TMP, { recursive: true });
        const input = path.join(TMP, "classic.wbinfo");
        fs.writeFileSync(input, icon);
        const o = await convert(input, "png");
        const png = read(o);
        expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        expect(png.readUInt32BE(16)).toBe(1);
        expect(png.readUInt32BE(20)).toBe(1);
        expect(o.external).toEqual([]);
    }, 300_000);

    it("does not advertise ImageMagick's MSL reader as a writer", async () => {
        const { page } = await newTrackedPage(browser, path.join(TMP, "msl-capability"));
        try {
            await page.goto(`${server.base}/`, { waitUntil: "networkidle0" });
            await waitForRegistry(page);
            const capabilities = await page.evaluate(() =>
                window.supportedFormatCache.get("ImageMagick")?.find(f => f.format === "msl"),
            );
            expect(capabilities).toMatchObject({ from: true, to: false });
        } finally {
            await page.close();
        }
    }, 120_000);

    it("png -> jpg is a plain success with no notice", async () => {
        const o = await convert(path.join(RES, "colors_50x50.png"), "jpeg");
        expect(read(o).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
        expect(o.modal).toMatch(/File converted!/);
        expect(o.modal).not.toMatch(/made of pictures|with limits/);
    }, 300_000);
});

