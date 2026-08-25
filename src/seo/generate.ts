// ---------------------------------------------------------------------------
// Orchestrator: build every static page and write it into dist/
// ---------------------------------------------------------------------------
// Exposed as a plain function so the same code path runs from the Vite plugin
// and from scripts/build-seo.ts. What gets verified standalone is what ships.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { FormatGraph, type FormatCache } from "./graph.ts";
import { buildLandingPages, formatsIndexPage, type Page } from "./pages.ts";
import { buildDocPages } from "./docs.ts";
import { buildSitemap, type SitemapEntry } from "./sitemap.ts";

export interface GenerateOptions {
  /** Repo root, used to find the markdown docs and public/cache.json. */
  root: string;
  /** Output directory, normally dist/. */
  outDir: string;
  /** Throw instead of warning when a pair has no route. The build sets this. */
  strict?: boolean;
  log?: (msg: string) => void;
}

export interface GenerateResult {
  written: string[];
  warnings: string[];
}

/**
 * The three app surfaces share one HTML file and therefore one title, one
 * description and one canonical, which all point at "/". Emitting a copy per
 * mode gives each its own indexable URL. Only the head differs: the body,
 * the scripts and the UI are byte-identical, so nothing a user sees changes.
 */
const MODES = [
  {
    path: "/convert/",
    title: "Convert files in your browser, no upload | frogConvert",
    description: "Convert between hundreds of file formats without uploading anything. Images, audio, video, documents and archives, all converted locally in your browser.",
  },
  {
    path: "/pdf/",
    title: "Edit PDFs in your browser, no upload | frogConvert",
    description: "Merge, reorder, rotate, extract and watermark PDF pages entirely in your browser. Your PDFs are never uploaded to a server.",
  },
  {
    path: "/compress/",
    title: "Compress images, audio, video and PDFs locally | frogConvert",
    description: "Make files smaller without changing their format or uploading them. Images, audio, video and PDFs are compressed in your browser.",
  },
];

export async function generateSeoPages(opts: GenerateOptions): Promise<GenerateResult> {
  const log = opts.log ?? (() => {});
  const cachePath = resolve(opts.root, "public/cache.json");
  if (!existsSync(cachePath)) throw new Error(`seo: cannot find ${cachePath}`);

  const graph = FormatGraph.fromCache(JSON.parse(readFileSync(cachePath, "utf-8")) as FormatCache);

  const { pages: landing, warnings } = buildLandingPages(graph, { strict: opts.strict });
  const docs = await buildDocPages(opts.root);
  const pages: Page[] = [...landing, formatsIndexPage(graph), ...docs];

  const written: string[] = [];
  for (const page of pages) {
    const file = resolve(opts.outDir, `.${page.path}index.html`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, page.html);
    written.push(page.path);
  }

  // Mode pages are copies of the built index.html with a rewritten head, so
  // they can only be produced once Vite has emitted it.
  const indexPath = resolve(opts.outDir, "index.html");
  const sitemapEntries: SitemapEntry[] = [
    { path: "/", priority: 1.0, changefreq: "weekly" },
    ...pages.filter(p => !p.noindex).map(p => ({ path: p.path, priority: p.priority, changefreq: "monthly" })),
  ];

  if (existsSync(indexPath)) {
    const indexHtml = readFileSync(indexPath, "utf-8");
    for (const mode of MODES) {
      const file = resolve(opts.outDir, `.${mode.path}index.html`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, rewriteHead(indexHtml, mode));
      written.push(mode.path);
      sitemapEntries.push({ path: mode.path, priority: 0.9, changefreq: "weekly" });
    }
  } else {
    warnings.push("dist/index.html not found, skipped the per-mode pages");
  }

  const lastmod = new Date().toISOString().slice(0, 10);
  writeFileSync(resolve(opts.outDir, "sitemap.xml"), buildSitemap(sitemapEntries, lastmod));
  written.push("/sitemap.xml");

  log(`seo: ${pages.length} pages, ${MODES.length} mode variants, ${sitemapEntries.length} sitemap URLs`);
  for (const w of warnings) log(`seo: WARNING ${w}`);

  return { written, warnings };
}

/**
 * Swaps title, description and canonical for a mode copy. Deliberately a
 * targeted replace rather than a rebuild: index.html carries inline scripts
 * whose sha256 the csp-hashes plugin pins, so the body must come through
 * untouched or those hashes stop matching and the scripts are blocked.
 */
function rewriteHead(html: string, mode: { path: string; title: string; description: string }): string {
  const canonical = `https://frogconvert.xyz${mode.path}`;
  return html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${mode.title}</title>`)
    .replace(/(<meta\s+name="description"\s+content=")[^"]*(")/, `$1${mode.description}$2`)
    .replace(/(<link\s+rel="canonical"\s+href=")[^"]*(")/, `$1${canonical}$2`)
    .replace(/(<meta\s+property="og:url"\s+content=")[^"]*(")/, `$1${canonical}$2`)
    .replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/, `$1${mode.title}$2`)
    .replace(/(<meta\s+property="og:description"\s+content=")[^"]*(")/, `$1${mode.description}$2`)
    .replace(/(<meta\s+name="twitter:url"\s+content=")[^"]*(")/, `$1${canonical}$2`)
    .replace(/(<meta\s+name="twitter:title"\s+content=")[^"]*(")/, `$1${mode.title}$2`)
    .replace(/(<meta\s+name="twitter:description"\s+content=")[^"]*(")/, `$1${mode.description}$2`);
}
