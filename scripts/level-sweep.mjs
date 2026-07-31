/**
 * Drive the real app and sweep every compression level on every surface.
 *
 * The point is bytes, not assertions about arg builders: a level that looks
 * wired up and produces identical output is the defect that has now appeared
 * three times in this release (video, then the PostScript routes). So each
 * scenario runs the whole flow, takes the downloaded file, and compares sizes.
 *
 * Usage: node sweep.mjs   (needs `vite preview` on :4173)
 */
import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";

const URL = "http://127.0.0.1:4173/";
const DL = "/tmp/dl";

const browser = await puppeteer.launch({
    executablePath: "/opt/pw-browsers/chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

async function freshPage() {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    fs.rmSync(DL, { recursive: true, force: true });
    fs.mkdirSync(DL, { recursive: true });
    const cdp = await page.createCDPSession();
    await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DL });
    page.on("pageerror", e => console.log("   [pageerror]", String(e).slice(0, 120)));
    await page.goto(URL, { waitUntil: "networkidle2", timeout: 90000 });
    await page.waitForFunction(() => (window.supportedFormatCache?.size ?? 0) > 0, { timeout: 90000 });
    await new Promise(r => setTimeout(r, 2500));
    return page;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Switch app mode through the segmented control. */
async function setMode(page, want) {
    await page.evaluate((w) => {
        const seg = document.querySelector("#app-mode-segmented");
        [...(seg?.querySelectorAll('button,[role="tab"],[role="radio"]') ?? [])]
            .find(e => new RegExp(w, "i").test(e.textContent + " " + (e.getAttribute("aria-label") || "") + " " + e.id))?.click();
    }, want);
    await sleep(1800);
}

/** Set the level through the top-bar compression menu (works in every mode). */
async function setLevel(page, value) {
    const ok = await page.evaluate((v) => {
        document.getElementById("quality-toggle")?.click();
        const item = [...document.querySelectorAll("#quality-menu .quality-item")]
            .find(i => i.dataset.value === v);
        if (!item) {
            document.getElementById("quality-toggle")?.click();
            return false;
        }
        item.click();
        return true;
    }, value);
    await sleep(600);
    return ok;
}

/** Wait until a file lands in the download dir, then return its size. */
async function waitForDownload(timeoutMs = 240000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const files = fs.readdirSync(DL).filter(f => !f.endsWith(".crdownload"));
        if (files.length) {
            await sleep(400);
            const f = files[0];
            return { name: f, size: fs.statSync(path.join(DL, f)).size };
        }
        await sleep(500);
    }
    return null;
}

function report(title, rows) {
    console.log(`\n=== ${title} ===`);
    for (const r of rows) console.log(`   ${String(r.level).padEnd(9)} ${r.note ?? String(r.size).padStart(9) + " B"}  ${r.name ?? ""}`);
    const sizes = rows.filter(r => typeof r.size === "number").map(r => r.size);
    const distinct = new Set(sizes).size;
    console.log(`   -> ${distinct} distinct size(s) across ${sizes.length} level(s)`);
    return { distinct, sizes };
}

// ---------------------------------------------------------------------------
// 1. Convert: PNG -> JPG at every level
// ---------------------------------------------------------------------------
async function convertSweep(levels, outFormat, label) {
    const rows = [];
    for (const level of levels) {
        const page = await freshPage();
        const had = await setLevel(page, level);
        if (!had) { rows.push({ level, note: "level not offered" }); await page.close(); continue; }

        const input = await page.$("input#file-input");
        await input.uploadFile("/tmp/fx/photo.png");
        await sleep(2500);

        // Pick the output format.
        await page.evaluate(() => document.querySelector("#format-selector")?.click());
        await sleep(1200);
        const picked = await page.evaluate((fmt) => {
            // Options are labelled "JPEG - Joint Photographic..." so match the
            // leading token, which is the format name.
            const hit = [...document.querySelectorAll(".format-option")]
                .find(o => new RegExp("^\\s*" + fmt + "\\b", "i").test(o.textContent || ""));
            if (hit) { hit.click(); return hit.textContent.trim().slice(0, 40); }
            return null;
        }, outFormat);
        if (!picked) { rows.push({ level, note: `output ${outFormat} not offered` }); await page.close(); continue; }
        await sleep(700);

        await page.evaluate(() => document.querySelector("#convert-button")?.click());
        const got = await waitForDownload();
        rows.push(got ? { level, size: got.size, name: got.name } : { level, note: "no download" });
        await page.close();
    }
    return report(label, rows);
}

// ---------------------------------------------------------------------------
// 2. PDF editor: merge two PDFs at every level
// ---------------------------------------------------------------------------
async function pdfEditSweep(levels) {
    const rows = [];
    for (const level of levels) {
        const page = await freshPage();
        await setMode(page, "pdf");
        const had = await setLevel(page, level);
        if (!had) { rows.push({ level, note: "level not offered" }); await page.close(); continue; }

        const inputs = await page.$$('input[type="file"]');
        let uploaded = false;
        for (const h of inputs) {
            const inPdf = await h.evaluate(e => !!e.closest("#pdf-workspace"));
            if (inPdf) { await h.uploadFile("/tmp/fx/a.pdf", "/tmp/fx/b.pdf"); uploaded = true; break; }
        }
        if (!uploaded && inputs.length) await inputs[0].uploadFile("/tmp/fx/a.pdf", "/tmp/fx/b.pdf");
        await sleep(6000);

        // The action is a .btn-primary labelled "Merge PDF". Matching any
        // button whose text starts with merge/save/download picked up the
        // wrong control and hung the run.
        const ran = await page.evaluate(() => {
            const btn = [...document.querySelectorAll("button.btn-primary")]
                .find(b => /merge pdf/i.test(b.textContent || "") && b.getBoundingClientRect().width > 0);
            if (btn) { btn.click(); return btn.textContent.trim().slice(0, 30); }
            return null;
        });
        await page.waitForFunction(() => [...document.querySelectorAll("button, a")]
            .some(b => /download/i.test(b.textContent || "") && b.getBoundingClientRect().width > 0),
            { timeout: 240000 }).catch(() => {});
        // A results view usually needs its own download press.
        await page.evaluate(() => {
            const btn = [...document.querySelectorAll("button, a")]
                .find(b => /download/i.test(b.textContent || "") && b.getBoundingClientRect().width > 0);
            btn?.click();
        });
        const got = await waitForDownload();
        rows.push(got ? { level, size: got.size, name: got.name } : { level, note: `no download (ran: ${ran})` });
        await page.close();
    }
    return report("PDF editor - merge two image-heavy PDFs", rows);
}

// ---------------------------------------------------------------------------
// 3. Compress surface at every level
// ---------------------------------------------------------------------------
async function compressSweep(levels) {
    const rows = [];
    for (const level of levels) {
        const page = await freshPage();
        await setMode(page, "compress");
        const had = await setLevel(page, level);
        if (!had) { rows.push({ level, note: "level not offered" }); await page.close(); continue; }

        const inputs = await page.$$('input[type="file"]');
        for (const h of inputs) {
            const inCw = await h.evaluate(e => !!e.closest("#compress-workspace, [id*=compress]"));
            if (inCw) { await h.uploadFile(process.env.CW_FILE || "/tmp/fx/photo.png"); break; }
        }
        await sleep(2500);
        await page.evaluate(() => document.querySelector(".cw-compress")?.click());
        // Wait for the results view. Automatic runs a probe pass first, so it
        // finishes later than an explicit level - a fixed sleep here reported
        // "no download" for a run that had in fact saved 29%.
        await page.waitForFunction(() => [...document.querySelectorAll("button")]
            .some(b => /download/i.test(b.textContent || "") && b.getBoundingClientRect().width > 0),
            { timeout: 240000 }).catch(() => {});
        await page.evaluate(() => {
            const btn = [...document.querySelectorAll("button")]
                .find(b => /download/i.test(b.textContent || "") && b.getBoundingClientRect().width > 0);
            btn?.click();
        });
        const got = await waitForDownload();
        rows.push(got ? { level, size: got.size, name: got.name } : { level, note: "no download" });
        await page.close();
    }
    return report("Compress surface - " + (process.env.CW_FILE || "/tmp/fx/photo.png"), rows);
}

const ALL = (process.env.LEVELS ?? "lossless,auto,high,medium,low").split(",");
const COMPRESS_LEVELS = ALL.filter(l => l !== "lossless");

const which = process.argv[2] ?? "all";
if (which === "convert" || which === "all") await convertSweep(ALL, "JPEG", "Convert - PNG to JPEG");
if (which === "lossless-target" || which === "all") await convertSweep(ALL, "ZIP", "Convert - PNG to ZIP (a level cannot apply)");
if (which === "pdf" || which === "all") await pdfEditSweep(ALL);
if (which === "compress" || which === "all") await compressSweep(COMPRESS_LEVELS);

await browser.close();
