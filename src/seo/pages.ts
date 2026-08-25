// ---------------------------------------------------------------------------
// Page models for the generated static pages
// ---------------------------------------------------------------------------
// Everything a page claims is either hand-written (src/seo/content.ts) or read
// from the live registry (src/seo/graph.ts). Nothing is asserted from a
// template alone, and a pair whose route has disappeared from the registry
// fails the build rather than shipping a page promising a conversion that no
// longer works.

import { FORMAT_CONTENT, PAIR_CONTENT, FORMAT_ALIASES } from "./content.ts";
import { FormatGraph } from "./graph.ts";
import { shell, faq, esc, type Crumb } from "./templates.ts";
import { ABSOLUTE_MAX_FILES, MAX_SINGLE_FILE_SIZE, MAX_TOTAL_FILE_SIZE } from "../constants/ui.ts";

export interface Page {
  /** Site-absolute path with trailing slash. Written as <path>index.html. */
  path: string;
  html: string;
  /** Sitemap priority. Hubs outrank pairs; both outrank docs. */
  priority: number;
  noindex?: boolean;
}

const gib = (n: number) => `${Math.round(n / (1024 ** 3))} GB`;
const mib = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;

/** Reader-facing engine names. The registry's handler ids are internal. */
/**
 * Display names for handlers, and whether the handler is actually WebAssembly.
 *
 * A handler absent from this map is never named on a page. The registry's own
 * handler names are internal identifiers - `renamezip`, `PdfCanvasCompress`,
 * `svgForeignObject` - and publishing them reads as a leak, not a credit. It
 * also keeps `meyda` off the format hubs: it declares image formats so it can
 * render waveforms, which is true of the graph and wrong about the app.
 *
 * `wasm` is not decoration. Claiming WebAssembly for the browser canvas, or
 * for a plain JS library like pdf.js or JSZip, is simply false, and the same
 * rule that keeps the registry's `lossless` flag off these pages applies here.
 */
const ENGINES: Record<string, { label: string; wasm: boolean }> = {
  FFmpeg: { label: "FFmpeg", wasm: true },
  ImageMagick: { label: "ImageMagick", wasm: true },
  Ghostscript: { label: "Ghostscript", wasm: true },
  pandoc: { label: "Pandoc", wasm: true },
  sevenZip: { label: "7-Zip", wasm: true },
  sqlite3: { label: "SQLite", wasm: true },
  imageToPdf: { label: "pdf-lib", wasm: false },
  pdfparse: { label: "pdf-parse", wasm: false },
  pdftotxt: { label: "pdf.js", wasm: false },
  pdftoimg: { label: "pdf.js", wasm: false },
  jszip: { label: "JSZip", wasm: false },
  canvasToBlob: { label: "the browser canvas", wasm: false },
  svgTrace: { label: "ImageTracer", wasm: false },
  font: { label: "fontkit", wasm: false },
  TextEncoding: { label: "the built-in text encoder", wasm: false },
  fromjson: { label: "the built-in JSON converter", wasm: false },
  tojson: { label: "the built-in JSON converter", wasm: false },
  // libreoffice is deliberately absent. It is a native binary reached through
  // the local API server or the desktop build, so on a hosted page it is
  // neither WebAssembly nor "running in this tab", and the surrounding copy
  // promises both. No page credits it today; leaving it out keeps it that way.
};

/** The label for a handler, or undefined when it has no vetted display name. */
const engineLabel = (h: string): string | undefined => ENGINES[h]?.label;

/** First handler in priority order that we are willing to name on a page. */
const namedEngine = (engines: string[]): { label: string; wasm: boolean } | undefined => {
  for (const h of engines) if (ENGINES[h]) return ENGINES[h];
  return undefined;
};

export const canonicalToken = (t: string): string => FORMAT_ALIASES[t.toLowerCase()] ?? t.toLowerCase();

const title = (t: string): string => FORMAT_CONTENT[t]?.title ?? t.toUpperCase();

export interface BuildResult {
  pages: Page[];
  /** Human-readable notes about what was skipped and why. */
  warnings: string[];
}

/**
 * Build every hub and pair page.
 *
 * `strict` makes an unroutable pair a thrown error rather than a warning. The
 * build turns it on: shipping a page for a conversion the app cannot perform
 * is worse than failing the build.
 */
export function buildLandingPages(graph: FormatGraph, opts: { strict?: boolean } = {}): BuildResult {
  const warnings: string[] = [];
  const pages: Page[] = [];

  const hubTokens = Object.keys(FORMAT_CONTENT).filter(t => {
    if (graph.canRead(t) || graph.canWrite(t)) return true;
    warnings.push(`hub ${t}: registry can neither read nor write it, skipped`);
    return false;
  });

  // Pairs first: hubs link to them, so they decide what a hub can advertise.
  const validPairs: Array<{ from: string; to: string; hops: number; engines: string[] }> = [];
  for (const key of Object.keys(PAIR_CONTENT)) {
    const [from, to] = key.split("→").map(canonicalToken);
    const route = graph.route(from, to);
    if (!route) {
      const why = `pair ${from}->${to}: no route in the registry`;
      if (opts.strict) throw new Error(why);
      warnings.push(why);
      continue;
    }
    validPairs.push({ from, to, hops: route.hops, engines: route.engines });
  }

  for (const p of validPairs) pages.push(pairPage(p, graph));
  for (const t of hubTokens) pages.push(hubPage(t, validPairs, graph));

  return { pages, warnings };
}

// --- pair pages ----------------------------------------------------------

function pairPage(
  p: { from: string; to: string; hops: number; engines: string[] },
  graph: FormatGraph,
): Page {
  const { from, to, hops, engines } = p;
  const key = `${from}→${to}`;
  const content = PAIR_CONTENT[key] ?? PAIR_CONTENT[`${from}→${to}`];
  const fromTitle = title(from);
  const toTitle = title(to);
  const path = `/convert/${from}-to-${to}/`;

  const pageTitle = `Convert ${fromTitle} to ${toTitle} in your browser | frogConvert`;
  const description = `${content.summary} Runs entirely in your browser, so the file is never uploaded.`;

  const named = namedEngine(engines);
  const engine = named
    ? `${named.label}${named.wasm ? ", compiled to WebAssembly," : ","} running in this tab`
    : `a ${hops}-step chain of local converters`;

  const fromInfo = graph.format(from);
  const toInfo = graph.format(to);

  const questions = [
    {
      q: `Is my file uploaded when converting ${fromTitle} to ${toTitle}?`,
      a: "No. The conversion runs entirely in your browser. The file never leaves your device, there is no server to upload to, and the page works offline once loaded.",
    },
    {
      q: `Is ${fromTitle} to ${toTitle} conversion free?`,
      a: "Yes, with no account, no watermark and no file limit per day. frogConvert is open source and there is no server cost to recover, because your device does the work.",
    },
    {
      q: `How large a file can I convert?`,
      a: `Up to ${gib(MAX_SINGLE_FILE_SIZE)} for a single file, ${mib(MAX_TOTAL_FILE_SIZE)} total per batch, and ${ABSOLUTE_MAX_FILES} files at once. The practical limit is your device's memory, since everything is processed locally.`,
    },
  ];
  if (content.caveat) {
    questions.push({
      q: `What is lost converting ${fromTitle} to ${toTitle}?`,
      a: content.caveat,
    });
  }
  const f = faq(questions);

  const howTo = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: `Convert ${fromTitle} to ${toTitle}`,
    description: content.summary,
    totalTime: "PT1M",
    tool: [{ "@type": "HowToTool", name: "A modern web browser" }],
    step: [
      { "@type": "HowToStep", name: "Open the converter", text: `Open frogConvert and select ${toTitle} as the output format.`, url: `${path}` },
      { "@type": "HowToStep", name: `Add your ${fromTitle} file`, text: `Drop the ${fromTitle} file onto the page, or click to browse. It stays on your device.` },
      { "@type": "HowToStep", name: "Convert and save", text: `Press Convert. The ${toTitle} file is produced locally and downloaded straight from the page.` },
    ],
  };

  const body = `
<h1>Convert ${esc(fromTitle)} to ${esc(toTitle)}</h1>
<p class="lede">${esc(content.summary)}</p>
<a class="cta" href="/convert?from=${esc(from)}&amp;to=${esc(to)}">Convert ${esc(fromTitle)} to ${esc(toTitle)} &rarr;</a>

<div class="card">
  <dl class="facts">
    <dt>Runs on</dt><dd>${esc(engine)}</dd>
    <dt>Steps</dt><dd>${hops === 1 ? "Direct, a single conversion" : `${hops} steps, chained automatically`}</dd>
    <dt>Input</dt><dd><code>.${esc(from)}</code>${fromInfo ? ` &middot; ${esc(fromInfo.mimes[0] ?? "")}` : ""}</dd>
    <dt>Output</dt><dd><code>.${esc(to)}</code>${toInfo ? ` &middot; ${esc(toInfo.mimes[0] ?? "")}` : ""}</dd>
    <dt>Uploads</dt><dd>None. The file never leaves your device.</dd>
  </dl>
</div>

${content.caveat ? `<h2>What to expect</h2>\n<p>${esc(content.caveat)}</p>` : ""}

<h2>Why convert ${esc(fromTitle)} without uploading</h2>
<p>Most online converters take your file, send it to their servers, convert it there and hand back a download link. That means your document sits on someone else's disk, subject to their retention policy and their breaches. It also means you cannot use them offline, and cannot use them at all for anything confidential.</p>
<p>frogConvert does the conversion in the page itself, with ${esc(named ? named.label : "the conversion engines")}${named && !named.wasm ? "" : " compiled to WebAssembly"}. There is no upload step because there is no server. You can disconnect from the network and it still works.</p>

<h2>About the formats</h2>
<h3>${esc(fromTitle)}</h3>
<p>${esc(FORMAT_CONTENT[from]?.blurb ?? "")} <a href="/formats/${esc(from)}/">More about ${esc(fromTitle)} files</a>.</p>
<h3>${esc(toTitle)}</h3>
<p>${esc(FORMAT_CONTENT[to]?.blurb ?? "")} <a href="/formats/${esc(to)}/">More about ${esc(toTitle)} files</a>.</p>

${f.html}
`.trim();

  return {
    path,
    priority: 0.7,
    html: shell({
      title: pageTitle,
      description,
      path,
      crumbs: [{ name: "frogConvert", path: "/" }, { name: "Convert", path: "/convert" }, { name: `${fromTitle} to ${toTitle}`, path }],
      jsonLd: [howTo, f.ld],
      body,
    }),
  };
}

// --- hub pages -----------------------------------------------------------

function hubPage(
  token: string,
  pairs: Array<{ from: string; to: string }>,
  graph: FormatGraph,
): Page {
  const info = graph.format(token);
  const c = FORMAT_CONTENT[token];
  const name = c.title;
  const path = `/formats/${token}/`;

  const outbound = pairs.filter(p => p.from === token);
  const inbound = pairs.filter(p => p.to === token);

  const readable = graph.canRead(token);
  const writable = graph.canWrite(token);

  // Only engines with a vetted display name; see ENGINES.
  const named3 = (hs: string[] | undefined) =>
    [...new Set((hs ?? []).map(engineLabel).filter((l): l is string => !!l))].slice(0, 3);
  const readers = named3(info?.readableBy);
  const writers = named3(info?.writableBy);

  const list = (items: Array<{ from: string; to: string }>) =>
    items.length
      ? `<ul class="grid">${items
          .map(p => `<li><a href="/convert/${p.from}-to-${p.to}/">${esc(title(p.from))} to ${esc(title(p.to))}</a></li>`)
          .join("")}</ul>`
      : "";

  const questions = [
    {
      q: `Can I open a ${name} file without installing anything?`,
      a: `Yes. frogConvert reads ${name} files directly in the browser and converts them to a format you already have software for. Nothing is installed and nothing is uploaded.`,
    },
    {
      q: `Are my ${name} files uploaded to a server?`,
      a: "No. Every conversion runs locally in your browser through WebAssembly. There is no server to send files to, and the app keeps working with the network disconnected.",
    },
  ];
  if (!writable && readable) {
    questions.push({
      q: `Can frogConvert create ${name} files?`,
      a: `No. ${name} can be read and converted from, but not written. Convert to another format instead.`,
    });
  }
  const f = faq(questions);

  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${name} conversions`,
    itemListElement: outbound.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: `Convert ${title(p.from)} to ${title(p.to)}`,
      url: `${"https://frogconvert.xyz"}/convert/${p.from}-to-${p.to}/`,
    })),
  };

  const body = `
<h1>${esc(name)} files</h1>
<p class="lede">${esc(c.blurb)}</p>

<div class="card">
  <dl class="facts">
    <dt>Extension</dt><dd><code>.${esc(info?.extensions[0] ?? token)}</code></dd>
    <dt>MIME type</dt><dd><code>${esc(info?.mimes[0] ?? "unknown")}</code></dd>
    <dt>Category</dt><dd>${esc(info?.categories[0] ?? "file")}</dd>
    <dt>Can convert from</dt><dd>${readable ? `Yes${readers.length ? `, via ${esc(readers.join(", "))}` : ""}` : "No"}</dd>
    <dt>Can convert to</dt><dd>${writable ? `Yes${writers.length ? `, via ${esc(writers.join(", "))}` : ""}` : "No, this format is read-only"}</dd>
  </dl>
</div>

${outbound.length ? `<h2>Convert ${esc(name)} to another format</h2>\n${list(outbound)}` : ""}
${inbound.length ? `<h2>Convert another format to ${esc(name)}</h2>\n${list(inbound)}` : ""}

<h2>Converting ${esc(name)} files privately</h2>
<p>frogConvert runs the conversion engines in your browser as WebAssembly, so a ${esc(name)} file is read, converted and saved without ever being sent anywhere. That matters most for the files people are least willing to upload: contracts, medical records, unreleased work, anything under an NDA.</p>
<p>It also means the converter works offline. Once the page has loaded, you can turn off the network and keep converting.</p>

${f.html}
`.trim();

  return {
    path,
    priority: 0.8,
    html: shell({
      title: `${name} files: what they are and how to convert them | frogConvert`,
      description: `${c.blurb.split(". ")[0]}. Convert ${name} files in your browser, with no upload.`,
      path,
      crumbs: [{ name: "frogConvert", path: "/" }, { name: "Formats", path: "/formats/" }, { name: name, path }],
      jsonLd: [itemList, f.ld],
      body,
    }),
  };
}

/** Index page listing every format hub, so the hubs are reachable by crawl. */
export function formatsIndexPage(graph: FormatGraph): Page {
  const tokens = Object.keys(FORMAT_CONTENT)
    .filter(t => graph.canRead(t) || graph.canWrite(t))
    .sort();
  const byCategory = new Map<string, string[]>();
  for (const t of tokens) {
    const cat = graph.format(t)?.categories[0] ?? "other";
    byCategory.set(cat, [...(byCategory.get(cat) ?? []), t]);
  }
  const sections = [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, list]) => `<h2>${esc(cat[0].toUpperCase() + cat.slice(1))}</h2>\n<ul class="grid">${list
      .map(t => `<li><a href="/formats/${t}/">${esc(title(t))}</a></li>`).join("")}</ul>`)
    .join("\n");

  const path = "/formats/";
  const body = `
<h1>Supported file formats</h1>
<p class="lede">frogConvert reads and writes hundreds of formats, all converted in your browser with no upload. These are the ones people ask for most; the converter itself handles many more.</p>
<p><a class="cta" href="/convert">Open the converter &rarr;</a></p>
${sections}
`.trim();

  return {
    path,
    priority: 0.8,
    html: shell({
      title: "Supported file formats | frogConvert",
      description: "Every file format frogConvert converts in your browser, grouped by type. No uploads, no account, no server.",
      path,
      crumbs: [{ name: "frogConvert", path: "/" }, { name: "Formats", path }],
      jsonLd: [],
      body,
    }),
  };
}
