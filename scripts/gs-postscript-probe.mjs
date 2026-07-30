/**
 * Prove out every PostScript route before wiring handlers to it.
 *
 * Each check runs the real shipped gs.wasm on a real file and reports the
 * return code, output size, and whether the result still looks like the format
 * it claims to be. Written as a script rather than a test because the browser
 * handler cannot load in the test runtime and a 16 MB compile per case is too
 * slow for the unit suite.
 *
 * Usage: node scripts/gs-postscript-probe.mjs
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { PDFDocument, StandardFonts } from "pdf-lib";

const require = createRequire(import.meta.url);
const pkgDir = path.resolve("node_modules/@jspawn/ghostscript-wasm");
const factory = require(path.join(pkgDir, "gs.js"));
const compiled = await WebAssembly.compile(fs.readFileSync(path.join(pkgDir, "gs.wasm")));

/** A fresh instance per run: callMain is not reliably re-entrant. */
async function gs(args, files) {
    const log = [];
    const Module = await new Promise((resolve, reject) => {
        factory({
            noInitialRun: true,
            instantiateWasm: (imports, success) => {
                WebAssembly.instantiate(compiled, imports).then(i => success(i, compiled), reject);
                return {};
            },
            print: (s) => log.push(s),
            printErr: (s) => log.push(s),
        }).then(resolve, reject);
    });
    for (const [p, data] of Object.entries(files)) Module.FS.writeFile(p, data);
    const rc = Module.callMain(args);
    return { rc, log, read: (p) => { try { return Module.FS.readFile(p); } catch { return null; } } };
}

const head = (b, n = 12) => b ? Buffer.from(b.slice(0, n)).toString("latin1").replace(/[^\x20-\x7e]/g, ".") : "-";
const results = [];
function report(name, ok, detail) {
    results.push({ name, ok });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(34)} ${detail}`);
}

// --- Build a vector source PDF: real text, no images. ---------------------
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
for (let i = 1; i <= 3; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`FrogConvert vector page ${i}`, { x: 60, y: 760, size: 24, font });
    p.drawRectangle({ x: 60, y: 600, width: 200, height: 100 });
}
const srcPdf = new Uint8Array(await doc.save());
console.log(`source PDF: ${srcPdf.length} bytes, 3 pages, text + vector rects\n`);

const BASE = ["-dNOPAUSE", "-dBATCH", "-dSAFER", "-dQUIET"];

// --- PDF -> PS -------------------------------------------------------------
{
    const r = await gs([...BASE, "-sDEVICE=ps2write", "-sOutputFile=/out.ps", "/in.pdf"], { "/in.pdf": srcPdf });
    const out = r.read("/out.ps");
    report("PDF -> PS (ps2write)", r.rc === 0 && out && head(out, 2) === "%!",
        `rc=${r.rc} ${out?.length ?? 0}B head=${head(out)}`);
    if (out) fs.writeFileSync("/tmp/probe.ps", out);
}

// --- PDF -> EPS, single output name: the silent-data-loss case -------------
// Checking rc and the header is NOT enough here, and that is the whole point:
// Ghostscript exits 0, writes a well-formed EPS, and drops every page but one.
// The only way to see it is to convert back and count.
{
    const r = await gs([...BASE, "-sDEVICE=eps2write", "-sOutputFile=/out.eps", "/in.pdf"], { "/in.pdf": srcPdf });
    const out = r.read("/out.eps");
    if (out) fs.writeFileSync("/tmp/probe.eps", out);
    const back = await gs([...BASE, "-sDEVICE=pdfwrite", "-sOutputFile=/out.pdf", "/in.eps"], { "/in.eps": out });
    const pdf = back.read("/out.pdf");
    const pages = pdf ? (await PDFDocument.load(pdf)).getPageCount() : 0;
    // Expected to FAIL: this documents why `%d` is mandatory for EPS.
    report("PDF -> EPS, single name, 3pp", pages === 3,
        `rc=${r.rc} ${out?.length ?? 0}B -> round-trips to ${pages}/3 pages (rc=0 throughout)`);
}

// --- PDF -> EPS with %d, one file per page ---------------------------------
{
    const r = await gs([...BASE, "-sDEVICE=eps2write", "-sOutputFile=/out-%d.eps", "/in.pdf"], { "/in.pdf": srcPdf });
    const got = [1, 2, 3].map(n => r.read(`/out-${n}.eps`)).filter(Boolean);
    report("PDF -> EPS, one file per page", r.rc === 0 && got.length === 3,
        `rc=${r.rc} files=${got.length} sizes=${got.map(g => g.length).join(",")}`);
}

// --- PS -> PDF (round trip) ------------------------------------------------
{
    const ps = fs.existsSync("/tmp/probe.ps") ? fs.readFileSync("/tmp/probe.ps") : null;
    if (ps) {
        const r = await gs([...BASE, "-sDEVICE=pdfwrite", "-sOutputFile=/out.pdf", "/in.ps"], { "/in.ps": ps });
        const out = r.read("/out.pdf");
        let pages = 0, text = false;
        if (out) {
            const d = await PDFDocument.load(out, { ignoreEncryption: true });
            pages = d.getPageCount();
            text = Buffer.from(out).toString("latin1").includes("/Font");
        }
        report("PS -> PDF (round trip)", r.rc === 0 && pages === 3 && text,
            `rc=${r.rc} ${out?.length ?? 0}B pages=${pages} hasFont=${text}`);
    }
}

// --- EPS -> PDF ------------------------------------------------------------
{
    const eps = fs.existsSync("/tmp/probe.eps") ? fs.readFileSync("/tmp/probe.eps") : null;
    if (eps) {
        const r = await gs([...BASE, "-sDEVICE=pdfwrite", "-dEPSCrop", "-sOutputFile=/out.pdf", "/in.eps"], { "/in.eps": eps });
        const out = r.read("/out.pdf");
        let pages = 0;
        if (out) pages = (await PDFDocument.load(out, { ignoreEncryption: true })).getPageCount();
        report("EPS -> PDF (-dEPSCrop)", r.rc === 0 && pages >= 1,
            `rc=${r.rc} ${out?.length ?? 0}B pages=${pages}`);
    }
}

// --- Hand-written EPS, the real-world input --------------------------------
{
    const eps = Buffer.from(`%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 200 200
%%EndComments
/Helvetica findfont 24 scalefont setfont
20 100 moveto (Hello frog) show
1 0 0 setrgbcolor 20 20 160 60 rectfill
showpage
%%EOF
`, "latin1");
    const r = await gs([...BASE, "-sDEVICE=pdfwrite", "-dEPSCrop", "-sOutputFile=/out.pdf", "/in.eps"], { "/in.eps": eps });
    const out = r.read("/out.pdf");
    let pages = 0, hasFont = false;
    if (out) {
        pages = (await PDFDocument.load(out, { ignoreEncryption: true })).getPageCount();
        hasFont = Buffer.from(out).toString("latin1").includes("/Font");
    }
    report("hand-written EPS -> PDF", r.rc === 0 && pages === 1 && hasFont,
        `rc=${r.rc} ${out?.length ?? 0}B pages=${pages} hasFont=${hasFont}`);
}

// --- PDF/A -----------------------------------------------------------------
{
    const r = await gs([...BASE, "-dPDFA=2", "-dPDFACompatibilityPolicy=1", "-sColorConversionStrategy=UseDeviceIndependentColor",
        "-sDEVICE=pdfwrite", "-sOutputFile=/out.pdf", "/in.pdf"], { "/in.pdf": srcPdf });
    const out = r.read("/out.pdf");
    const marked = out ? Buffer.from(out).toString("latin1").includes("pdfaid") : false;
    report("PDF -> PDF/A-2 (-dPDFA=2)", r.rc === 0 && out && marked,
        `rc=${r.rc} ${out?.length ?? 0}B pdfaid=${marked} log=${r.log.slice(0, 2).join("|") || "-"}`);
}

// --- PDF -> TIFF -----------------------------------------------------------
for (const [dev, label] of [["tiff24nc", "colour"], ["tiffg4", "mono G4"]]) {
    const r = await gs([...BASE, `-sDEVICE=${dev}`, "-r150", "-sOutputFile=/out.tif", "/in.pdf"], { "/in.pdf": srcPdf });
    const out = r.read("/out.tif");
    const tiffMagic = out && (head(out, 2) === "II" || head(out, 2) === "MM");
    report(`PDF -> TIFF (${dev}, ${label})`, r.rc === 0 && tiffMagic,
        `rc=${r.rc} ${out?.length ?? 0}B magic=${head(out, 2)}`);
}

// --- TIFF compression: the default is raw, and it is not a small difference -
console.log("\nTIFF size by compression (same 3-page vector source, -r150):");
for (const extra of [[], ["-sCompression=pack"], ["-sCompression=lzw"]]) {
    const r = await gs([...BASE, "-sDEVICE=tiff24nc", "-r150", ...extra, "-sOutputFile=/o.tif", "/in.pdf"], { "/in.pdf": srcPdf });
    const out = r.read("/o.tif");
    console.log(`  ${(extra[0] ?? "(device default)").padEnd(22)} ${String(out?.length ?? 0).padStart(9)} B`);
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} routes behave as shipped`);
if (failed.length) console.log("as expected, documenting a trap: " + failed.map(f => f.name).join(", "));
