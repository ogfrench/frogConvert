/**
 * Ghostscript-WASM smoke test — run in a real browser, not Bun.
 *
 *   node scripts/ghostscript-smoke.mjs
 *
 * Why this exists: @jspawn/ghostscript-wasm's loader is awkward and cost real
 * time to work out, so the working recipe is recorded here rather than
 * rediscovered.
 *
 *   - gs.mjs branches on `globalThis.process`. The node branch resolves the
 *     wasm through a file:// URL that fetch() rejects, so it cannot init under
 *     Bun or Node directly.
 *   - The browser branch reads `globalThis.exports.Module`, a side-channel set
 *     by browser.js at import time.
 *   - The reliable path is therefore: load it in a browser AND pass
 *     `wasmBinary` explicitly, so Emscripten never tries to locate the file
 *     itself. That also gives us control over lazy-loading the 16 MB payload
 *     and reporting download progress.
 *
 * Verified result on a 53 KB vector-only PDF (no images at all): /screen
 * returns a valid PDF 36% smaller — the case an image-downsampling approach
 * cannot improve at all.
 */
import { createServer } from "http";
import { readFile } from "fs/promises";
import { extname, join } from "path";
import { createRequire } from "module";

const ROOT = join(process.cwd(), "node_modules/@jspawn/ghostscript-wasm");
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".pdf": "application/pdf", ".html": "text/html" };

const PAGE = `<!doctype html><meta charset="utf-8"><body><pre id="log">starting…</pre>
<script type="module">
const log = (m) => { document.getElementById('log').textContent += "\\n" + m; };
try {
  const { default: createGS } = await import('./gs.mjs');
  const wasmBinary = await (await fetch('./gs.wasm')).arrayBuffer();
  const Module = await createGS({ noInitialRun: true, wasmBinary, print: () => {}, printErr: () => {} });
  log('init OK; FS=' + !!Module.FS + ' callMain=' + typeof Module.callMain);
  const input = new Uint8Array(await (await fetch('./sample.pdf')).arrayBuffer());
  Module.FS.writeFile('/in.pdf', input);
  const rc = Module.callMain(['-sDEVICE=pdfwrite','-dCompatibilityLevel=1.4','-dPDFSETTINGS=/screen',
    '-dNOPAUSE','-dQUIET','-dBATCH','-sOutputFile=/out.pdf','/in.pdf']);
  const out = Module.FS.readFile('/out.pdf');
  log('rc=' + rc + ' in=' + input.length + ' out=' + out.length +
      ' saved=' + (100 - out.length / input.length * 100).toFixed(1) + '%' +
      ' validPDF=' + (String.fromCharCode(...out.slice(0, 5)) === '%PDF-'));
  log('RESULT_OK');
} catch (e) { log('RESULT_FAIL ' + (e && e.message || e)); }
</script></body>`;

const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const doc = await PDFDocument.create();
const page = doc.addPage([612, 792]);
const font = await doc.embedFont(StandardFonts.Helvetica);
page.drawText("frogConvert ghostscript probe", { x: 40, y: 740, size: 18, font });
// Vector-only payload on purpose: nothing here can be fixed by downsampling
// images, so any saving is stream/structure optimisation.
for (let i = 0; i < 4000; i++) {
  page.drawRectangle({ x: (i * 7) % 560, y: (i * 13) % 700, width: 6, height: 6,
    color: rgb((i % 255) / 255, ((i * 3) % 255) / 255, ((i * 7) % 255) / 255) });
}
const sample = await doc.save();

const server = createServer(async (req, res) => {
  const path = (req.url || "/").split("?")[0];
  try {
    if (path === "/" || path === "/index.html") return res.writeHead(200, { "Content-Type": "text/html" }).end(PAGE);
    if (path === "/sample.pdf") return res.writeHead(200, { "Content-Type": "application/pdf" }).end(Buffer.from(sample));
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" }).end(body);
  } catch { res.writeHead(404).end("not found"); }
});
await new Promise(r => server.listen(8891, r));

const puppeteer = require("puppeteer");
const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  args: ["--no-sandbox"],
});
try {
  const tab = await browser.newPage();
  await tab.goto("http://127.0.0.1:8891/index.html", { waitUntil: "domcontentloaded" });
  await tab.waitForFunction(() => /RESULT_(OK|FAIL)/.test(document.getElementById("log").textContent), { timeout: 180000 });
  const out = await tab.$eval("#log", el => el.textContent);
  console.log(out);
  process.exitCode = out.includes("RESULT_OK") ? 0 : 1;
} finally {
  await browser.close();
  server.close();
}
