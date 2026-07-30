/**
 * End-to-end check of the real Ghostscript handler, not a mock of it.
 *
 * Drives `GhostscriptNodeHandler.doConvert` over every route #19 added, with
 * real files, and inspects what comes back. This is the Node sibling of the
 * browser handler and shares all of core/ghostscript/, so a pass here exercises
 * the same argv, the same output collection and the same validation the web UI
 * runs — only the loader differs.
 *
 * Lives in scripts/ rather than the unit suite because each case compiles 16 MB
 * of WASM; the suite would go from seconds to minutes.
 *
 * Usage: bun run scripts/gs-handler-e2e.mjs
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import CommonFormats from "../src/core/CommonFormats/CommonFormats.ts";
import GhostscriptNodeHandler from "../src/handlers/ghostscript.node.ts";

const handler = new GhostscriptNodeHandler();
await handler.init();

const fmt = (def, ref, from, to) => def.supported(ref, from, to);
const PDF = fmt(CommonFormats.PDF, "pdf", true, true);
const PS = fmt(CommonFormats.PS, "ps", true, true);
const EPS = fmt(CommonFormats.EPS, "eps", true, true);
const AI = fmt(CommonFormats.AI, "ai", true, false);
const PDFA = fmt(CommonFormats.PDFA, "pdfa", false, true);
const TIFF = fmt(CommonFormats.TIFF, "tiff", false, true);

let pass = 0, fail = 0;
function check(name, ok, detail) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(40)} ${detail}`);
    ok ? pass++ : fail++;
}

// --- A 3-page vector PDF: real text, real rectangles, no rasters. ---------
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
for (let i = 1; i <= 3; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`FrogConvert vector page ${i}`, { x: 60, y: 760, size: 24, font });
    p.drawRectangle({ x: 60, y: 600, width: 200, height: 100 });
}
const srcPdf = new Uint8Array(await doc.save());
const pdfFile = { name: "report.pdf", bytes: srcPdf };
const asText = (b) => Buffer.from(b).toString("latin1");

// --- PDF -> PS ------------------------------------------------------------
let psFile;
{
    const [out] = await handler.doConvert([pdfFile], PDF, PS);
    psFile = { name: out.name, bytes: out.bytes };
    check("PDF -> PS", out.name === "report.ps" && asText(out.bytes).startsWith("%!PS-Adobe"),
        `${out.name} ${out.bytes.byteLength}B`);
}

// --- PDF -> EPS: must fan out to one file per page, not silently drop 2 ----
{
    const outs = await handler.doConvert([pdfFile], PDF, EPS);
    const named = outs.map(o => o.name).join(", ");
    check("PDF -> EPS fans out per page", outs.length === 3 && named.includes("report_page_2.eps"),
        `${outs.length} files: ${named}`);
}

// --- PS -> PDF: vector content must survive as vector ---------------------
{
    const [out] = await handler.doConvert([psFile], PS, PDF);
    const back = await PDFDocument.load(out.bytes, { ignoreEncryption: true });
    const text = asText(out.bytes);
    check("PS -> PDF keeps 3 pages + fonts",
        out.name === "report.pdf" && back.getPageCount() === 3 && text.includes("/Font"),
        `${out.bytes.byteLength}B pages=${back.getPageCount()}`);
    // A rasterised "conversion" would carry an image XObject and no font.
    check("PS -> PDF did not rasterise", !text.includes("/Subtype /Image"),
        `hasImageXObject=${text.includes("/Subtype /Image")}`);
}

// --- Hand-written EPS -> PDF, the format people actually have -------------
const handEps = Buffer.from(`%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 200 200
%%EndComments
/Helvetica findfont 24 scalefont setfont
20 100 moveto (Hello frog) show
1 0 0 setrgbcolor 20 20 160 60 rectfill
showpage
%%EOF
`, "latin1");
{
    const [out] = await handler.doConvert([{ name: "logo.eps", bytes: new Uint8Array(handEps) }], EPS, PDF);
    const back = await PDFDocument.load(out.bytes, { ignoreEncryption: true });
    const size = back.getPage(0).getSize();
    check("EPS -> PDF crops to the bounding box",
        out.name === "logo.pdf" && back.getPageCount() === 1 && Math.round(size.width) === 200,
        `${out.bytes.byteLength}B ${Math.round(size.width)}x${Math.round(size.height)}pt`);
}

// --- AI -> PDF, both flavours of .ai --------------------------------------
{
    // Modern: a PDF wearing an .ai extension.
    const [out] = await handler.doConvert([{ name: "art.ai", bytes: srcPdf }], AI, PDF);
    const back = await PDFDocument.load(out.bytes, { ignoreEncryption: true });
    check("AI (PDF-based) -> PDF", out.name === "art.pdf" && back.getPageCount() === 3,
        `${out.bytes.byteLength}B pages=${back.getPageCount()}`);
}
{
    // Pre-Illustrator 9: an EPS wearing an .ai extension.
    const [out] = await handler.doConvert([{ name: "old.ai", bytes: new Uint8Array(handEps) }], AI, PDF);
    const back = await PDFDocument.load(out.bytes, { ignoreEncryption: true });
    check("AI (EPS-based) -> PDF", out.name === "old.pdf" && back.getPageCount() === 1,
        `${out.bytes.byteLength}B pages=${back.getPageCount()}`);
}

// --- PDF/A ----------------------------------------------------------------
{
    const [out] = await handler.doConvert([pdfFile], PDF, PDFA);
    const text = asText(out.bytes);
    check("PDF -> PDF/A-2b is actually marked",
        out.name === "report.pdf" && text.includes("pdfaid") && text.includes("%PDF-"),
        `${out.bytes.byteLength}B pdfaid=${text.includes("pdfaid")}`);
}

// --- TIFF: multi-page, and compressed --------------------------------------
{
    const [out] = await handler.doConvert([pdfFile], PDF, TIFF);
    const magic = asText(out.bytes.slice(0, 2));
    // Uncompressed at 150 dpi this source is ~19.5 MB; LZW brings it to ~55 KB.
    check("PDF -> TIFF is LZW, not 19 MB raw",
        out.name === "report.tiff" && (magic === "II" || magic === "MM") && out.bytes.byteLength < 2_000_000,
        `${out.bytes.byteLength}B magic=${magic}`);
}

// --- Rejections should be errors, not silent wrong output ------------------
for (const [name, inF, outF] of [
    ["refuses PNG output", PDF, fmt(CommonFormats.PNG, "png", false, true)],
    ["refuses DOCX input", fmt(CommonFormats.DOCX, "docx", true, false), PDF],
]) {
    let threw = false;
    try { await handler.doConvert([pdfFile], inF, outF); } catch { threw = true; }
    check(name, threw, threw ? "threw" : "returned output!");
}

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
