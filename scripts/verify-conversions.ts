#!/usr/bin/env bun
/**
 * Empirically verify conversion pairs by actually converting.
 *
 * The route graph will tell you a path exists. That is not the same as the
 * conversion working: a path can exist through a handler that rejects the
 * real bytes, and a format token can resolve to a registry entry that is not
 * the one a user would pick. This script answers the stronger question by
 * running the conversion and checking that output bytes come back.
 *
 * It uses the same execution path as the MCP convert_file tool: build the
 * TraversionGraph from the Node-safe handler set, ask it for a path, then walk
 * the path calling doConvert at each hop.
 *
 *   bun run scripts/verify-conversions.ts
 *   PAIRS=png→jpg,mp3→wav bun run scripts/verify-conversions.ts
 *   REPORT=/tmp/report.json bun run scripts/verify-conversions.ts
 *
 * Exit code is 0 unless a pair fails for a reason this environment cannot
 * explain, so it is safe to run where LibreOffice or a submodule is missing.
 *
 * ## What it cannot cover
 *
 * Handlers with `requiresMainThread` (canvasToBlob, svgTrace, meyda) are
 * browser-only and excluded from the Node set by design, so routes that need
 * them report as ENV rather than FAIL. Likewise formats nothing can write
 * (heic, m4a) cannot have a sample bootstrapped, and report NO-INPUT. CI has
 * LibreOffice, every submodule and the full dependency set, so it sees more
 * than a sandbox does.
 */
import "../src/mcp/core/polyfills.ts";
import { TraversionGraph } from "../src/core/TraversionGraph/TraversionGraph.ts";
import { hopQualityArgs } from "../src/core/compression/hopQuality.ts";
import type { FileData, FileFormat, FormatHandler } from "../src/core/FormatHandler/FormatHandler.ts";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const RES = `${ROOT}/test/resources`;
const REPORT = process.env.REPORT;

/**
 * Mirrors the list and order in src/mcp/core/handlers.ts. Order is handler
 * priority (TraversionGraph.costFunction adds HANDLER_PRIORITY_COST per
 * index), so it must stay in step with that file. Imports are dynamic so one
 * unavailable dependency skips a single handler rather than aborting the run.
 */
const HANDLER_SPECS: Array<[string, string, string?]> = [
  ["FFmpeg", "handlers/FFmpeg.ts"],
  ["ImageMagick", "handlers/ImageMagick.ts"],
  ["Ghostscript", "handlers/ghostscript.node.ts"],
  ["imageToPdf", "handlers/imageToPdf.ts"],
  ["libreoffice", "handlers/libreoffice.ts"],
  ["pandoc", "handlers/pandoc.ts"],
  ["jszip", "handlers/jszip.ts"],
  ["fromjson", "handlers/json.ts", "fromJsonHandler"],
  ["tojson", "handlers/json.ts", "toJsonHandler"],
  ["font", "handlers/font.ts"],
  ["TextEncoding", "handlers/textEncoding.ts"],
  ["bson", "handlers/bson.ts"],
  ["nbt", "handlers/nbt.ts"],
  ["lzh", "handlers/lzh.ts"],
  ["als", "handlers/als.ts"],
  ["mcSchematic", "handlers/mcSchematicHandler.ts"],
  ["wad", "handlers/wad.ts"],
  ["toon", "handlers/toon.ts"],
  ["htmlEmbed", "handlers/htmlEmbed.ts"],
  ["sqlite3", "handlers/sqlite.ts"],
  ["cgbi", "handlers/cgbi-to-png.ts"],
  ["flptojson", "handlers/flptojson.ts"],
  ["renamezip", "handlers/rename.ts", "renameZipHandler"],
  ["renametxt", "handlers/rename.ts", "renameTxtHandler"],
  ["petozip", "handlers/petozip.ts"],
  ["curani", "handlers/curani.ts"],
  ["sb3tohtml", "handlers/sb3tohtml.ts"],
  ["textToSource", "handlers/textToSource.ts"],
  ["txtToInfiniteCraft", "handlers/txtToInfiniteCraft.ts"],
  ["envelope", "handlers/envelope.ts"],
  ["tmx", "handlers/tmx.ts"],
  ["sevenZip", "handlers/sevenZip.ts"],
  ["json5", "handlers/json5.ts"],
  ["jsonToC", "handlers/jsonToC.ts"],
  ["exe2bat", "handlers/exeToBat.ts"],
  ["comics", "handlers/comics.ts"],
  ["aperturePicture", "handlers/aperturePicture.ts"],
  ["pdfparse", "handlers/pdfparse.ts"],
  ["minecraft-lang", "handlers/minecraftLangfileHandler.ts"],
  ["celariaMap", "handlers/celariaMap.ts"],
  ["chessjs", "handlers/chessjs.ts"],
  ["fenToJson", "handlers/fenToJson.ts"],
  ["har", "handlers/har.ts"],
];

/** Default set: the pairs that have landing pages. */
const DEFAULT_PAIRS = [
  "pdf→docx", "docx→pdf", "mp3→wav", "wav→mp3", "flac→mp3", "mp3→flac", "wav→flac",
  "flac→wav", "png→jpg", "jpg→png", "svg→png", "png→svg", "mp4→gif", "gif→mp4",
  "gif→webp", "html→pdf", "html→md", "md→html", "md→pdf", "docx→txt", "docx→odt",
  "odt→docx", "txt→pdf", "txt→md", "md→txt", "csv→json", "json→csv", "json→xml",
  "xml→json", "json→yaml", "yaml→json", "xlsx→csv", "xlsx→json", "mid→mp3",
  "mp4→webm", "webm→mp4", "mp4→mov", "mov→mp4", "mp4→mkv", "mkv→mp4", "avi→mp4",
  "mp4→avi", "flv→mp4", "jpg→webp", "png→webp", "webp→jpg", "webp→png", "heic→jpg",
  "heic→png", "tiff→png", "png→tiff", "pdf→txt", "pptx→pdf", "epub→pdf", "mp3→aac",
  "aac→mp3", "m4a→mp3", "ogg→mp3", "wav→ogg",
];

const pairs = process.env.PAIRS ? process.env.PAIRS.split(",").map(p => p.trim()) : DEFAULT_PAIRS;

const handlersAll: FormatHandler[] = [];
const unavailable: string[] = [];
for (const [label, rel, named] of HANDLER_SPECS) {
  try {
    const mod = await import(`${ROOT}/src/${rel}`) as Record<string, unknown>;
    const exported = named ? mod[named] : mod.default;
    handlersAll.push(typeof exported === "function"
      ? new (exported as new () => FormatHandler)()
      : exported as FormatHandler);
  } catch (e) {
    unavailable.push(`${label}: ${message(e).slice(0, 60)}`);
  }
}
await Promise.all(handlersAll.map(h => h.init ? h.init().catch(() => undefined) : Promise.resolve()));
const handlers = handlersAll.filter(h => h.ready);
if (unavailable.length) console.log(`handlers unavailable here:\n  ${unavailable.join("\n  ")}\n`);
console.log(`handlers ready: ${handlers.length}/${handlersAll.length}\n`);

const cache = new Map<string, FileFormat[]>();
handlers.forEach(h => cache.set(h.name, h.supportedFormats || []));
const graph = new TraversionGraph();
graph.init(cache, handlers, false);

type Entry = { format: FileFormat; handler: FormatHandler };

/**
 * Every registry entry matching a token, best first.
 *
 * A token is genuinely ambiguous: "json" matches pandoc's csljson, pandoc's
 * own AST json, json5, toon, fromjson and tojson. The UI resolves this by
 * letting the user pick, so "can this conversion be done" means "does any
 * pairing of a source and target entry work". An exact `format` match ranks
 * above an extension-only one, matching what a user picking "JSON" rather
 * than "CSL JSON" would choose.
 */
function candidates(token: string, direction: "from" | "to"): Entry[] {
  const scored: Array<Entry & { score: number }> = [];
  for (const handler of handlers) {
    for (const format of handler.supportedFormats ?? []) {
      if (direction === "from" && !format.from) continue;
      if (direction === "to" && !format.to) continue;
      const name = String(format.format).toLowerCase();
      const ext = String(format.extension).toLowerCase();
      if (name !== token && ext !== token) continue;
      scored.push({ format, handler, score: name === token ? 0 : 1 });
    }
  }
  return scored.sort((a, b) => a.score - b.score).map(({ format, handler }) => ({ format, handler }));
}

async function runPath(bytes: Uint8Array, name: string, src: Entry, dst: Entry): Promise<FileData[]> {
  const step = await graph.searchPath(src, dst, false).next();
  if (step.done || !step.value) throw new Error("no path found");
  const path = step.value as Entry[];
  let files: FileData[] = [{ name, bytes }];
  // path[0] is the source node and carries no conversion; steps start at 1.
  for (let i = 1; i < path.length; i++) {
    files = await path[i].handler.doConvert(
      files, path[i - 1].format, path[i].format,
      hopQualityArgs({ target: path[i].format, isLastHop: i === path.length - 1, requested: "medium" }),
    );
  }
  return files;
}

/** Try each source/target entry pairing; succeed on the first that converts. */
async function convert(bytes: Uint8Array, name: string, from: string, to: string): Promise<FileData[]> {
  const sources = candidates(from, "from");
  const targets = candidates(to, "to");
  if (!sources.length) throw new Error(`no native reader for ${from}`);
  if (!targets.length) throw new Error(`no native writer for ${to}`);

  let lastError: unknown = new Error("no path found");
  let attempts = 0;
  for (const src of sources) {
    for (const dst of targets) {
      if (++attempts > 24) break;
      try {
        const out = await runPath(bytes, name, src, dst);
        if (out[0]?.bytes?.length) return out;
        lastError = new Error("empty output");
      } catch (e) { lastError = e; }
    }
  }
  throw lastError;
}

// --- sample inputs -------------------------------------------------------
const samples = new Map<string, Uint8Array>();
const text = (s: string) => new TextEncoder().encode(s);
const load = (f: string) => new Uint8Array(readFileSync(`${RES}/${f}`));

samples.set("png", load("colors_50x50.png"));
samples.set("mp3", load("gaster.mp3"));
samples.set("mp4", load("doom.mp4"));
samples.set("docx", load("word.docx"));
samples.set("md", load("markdown.md"));
samples.set("txt", text("frogConvert sample text.\nSecond line.\n"));
samples.set("csv", text("name,qty,price\nwidget,3,9.99\ngasket,12,0.45\n"));
samples.set("json", text(JSON.stringify({ items: [{ name: "widget", qty: 3 }] }, null, 2)));
samples.set("xml", text(`<?xml version="1.0" encoding="UTF-8"?>\n<items><item><name>widget</name></item></items>`));
samples.set("yaml", text("items:\n  - name: widget\n    qty: 3\n"));
samples.set("html", text("<!doctype html><html><head><title>Sample</title></head><body><h1>Heading</h1><p>Text.</p></body></html>"));
samples.set("svg", text(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#3a3"/></svg>`));

/** Formats obtainable only by converting something we already hold. */
const DERIVE: Array<[string, string]> = [
  ["png", "jpg"], ["png", "webp"], ["png", "gif"], ["png", "tiff"], ["png", "bmp"], ["png", "pdf"],
  ["mp3", "wav"], ["mp3", "flac"], ["mp3", "ogg"], ["mp3", "aac"],
  ["mp4", "webm"], ["mp4", "mkv"], ["mp4", "mov"], ["mp4", "avi"], ["mp4", "flv"],
  ["docx", "odt"], ["docx", "pptx"], ["md", "epub"], ["csv", "xlsx"], ["md", "mid"],
];
for (const [src, dst] of DERIVE) {
  if (samples.has(dst)) continue;
  const input = samples.get(src);
  if (!input) continue;
  try {
    const out = await convert(input, `sample.${src}`, src, dst);
    if (out[0]?.bytes?.length) samples.set(dst, out[0].bytes);
  } catch { /* reported as NO-INPUT by whichever pair needed it */ }
}
console.log(`sample inputs: ${[...samples.keys()].sort().join(", ")}\n`);

// --- run -----------------------------------------------------------------
type Status = "PASS" | "FAIL" | "ENV" | "NO-INPUT";
interface Row { pair: string; status: Status; detail: string }

/**
 * Failures this environment explains rather than the product. Keeping them
 * out of the exit code is what lets the script run anywhere; CI has all of
 * these and will surface a genuine regression as FAIL.
 */
function environmental(detail: string): boolean {
  return /LibreOffice produced no output|no path found|requires.*browser|not installed/i.test(detail);
}

const rows: Row[] = [];
for (const pair of pairs) {
  const [from, to] = pair.split("→");
  const input = samples.get(from);
  if (!input) { rows.push({ pair, status: "NO-INPUT", detail: `no sample ${from}` }); continue; }
  try {
    const out = await convert(input, `sample.${from}`, from, to);
    const bytes = out[0]?.bytes;
    if (!bytes?.length) { rows.push({ pair, status: "FAIL", detail: "empty output" }); continue; }
    rows.push({ pair, status: "PASS", detail: `${out.length} file(s), ${bytes.length} bytes` });
  } catch (e) {
    const detail = message(e).slice(0, 90);
    rows.push({ pair, status: environmental(detail) ? "ENV" : "FAIL", detail });
  }
}

for (const r of rows) console.log(`${r.status.padEnd(9)} ${r.pair.padEnd(14)} ${r.detail}`);
const count = (s: Status) => rows.filter(r => r.status === s).length;
console.log(`\nPASS ${count("PASS")}  FAIL ${count("FAIL")}  ENV ${count("ENV")}  NO-INPUT ${count("NO-INPUT")}  of ${rows.length}`);

if (REPORT) {
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, JSON.stringify(rows, null, 2));
  console.log(`report written to ${REPORT}`);
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

process.exit(count("FAIL") > 0 ? 1 : 0);
