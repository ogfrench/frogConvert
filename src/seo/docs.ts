// ---------------------------------------------------------------------------
// Static rendering of the markdown docs
// ---------------------------------------------------------------------------
// The docs page fetches raw markdown at runtime and renders it client-side,
// selecting the document from location.hash. That gives all 13 docs a single
// indexable URL, /docs/, whose HTML body is the word "Loading". Crawlers treat
// fragments as one URL, and LLM retrieval fetchers largely do not run JS, so
// the entire documentation surface is invisible to them.
//
// This renders each document to its own real URL at build time. The SPA keeps
// working; it just stops being the only way to read a doc.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { marked } from "marked";
import { shell, esc } from "./templates.ts";
import type { Page } from "./pages.ts";
import { createMermaidRenderer } from "./mermaid-svg.ts";

export interface DocMeta {
  /** Source filename, e.g. "ARCHITECTURE.md". */
  file: string;
  icon: string;
  label: string;
  desc: string;
  /** Absolute path on disk. */
  fullPath: string;
}

/**
 * Frontmatter parser shared with the VITE_NAV_DOCS scanner in vite.config.js.
 * Both YAML `---` blocks and the `<!-- docs-frontmatter -->` HTML comment form
 * are supported, because the repo uses the second.
 */
export function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    || content.match(/^<!--\s*docs-frontmatter\r?\n([\s\S]*?)\r?\n-->/);
  if (!match) return null;
  const fm: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const [key, ...rest] = line.split(":");
    if (key && rest.length) fm[key.trim()] = rest.join(":").trim();
  }
  return fm;
}

/** Strips the frontmatter block so it is not rendered into the page body. */
export function stripFrontmatter(content: string): string {
  return content
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, "")
    .replace(/^<!--\s*docs-frontmatter\r?\n[\s\S]*?\r?\n-->/, "")
    .trim();
}

/** README first, then alphabetical by label, matching the sidebar's order. */
export function discoverDocs(root: string): DocMeta[] {
  const found: DocMeta[] = [];
  const seen = new Set<string>();

  for (const dir of [root, resolve(root, "docs")]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md") || seen.has(file)) continue;
      const fullPath = resolve(dir, file);
      const fm = parseFrontmatter(readFileSync(fullPath, "utf-8"));
      if (!fm?.label) continue;
      seen.add(file);
      found.push({ file, icon: fm.icon || "\u{1F4DD}", label: fm.label, desc: fm.desc || "", fullPath });
    }
  }

  return found.sort((a, b) => {
    if (a.file === "README.md") return -1;
    if (b.file === "README.md") return 1;
    return a.label.localeCompare(b.label);
  });
}

/** "ARCHITECTURE.md" -> "architecture". README is the /docs/ index itself. */
/**
 * `/docs/` is NOT available to us. `docs/index.html` is a Vite rollup input:
 * the docs app, which reads `location.hash` to pick a document and renders
 * its mermaid diagrams. The seo-pages plugin runs in `writeBundle`, so
 * emitting a page at `/docs/` overwrites that app after it is built, killing
 * every `/docs/#SOMEDOC.md` deep link and orphaning its 1.6 MB bundle.
 * README therefore gets `/docs/readme/` like every other document.
 */
export function docSlug(file: string): string {
  return file === "README.md" ? "readme" : file.replace(/\.md$/i, "").toLowerCase();
}

/**
 * The changelog is 111 KB of release notes. It is worth having at a real URL
 * so it can be linked and read, but it is not a page we want competing in
 * search results, so it ships noindex.
 */
const NOINDEX = new Set(["CHANGELOG.md"]);

/** Rewrites in-repo markdown links so they point at the generated URLs. */
function rewriteLinks(html: string, docs: DocMeta[]): string {
  const known = new Map(docs.map(d => [d.file.toLowerCase(), docSlug(d.file)]));
  return html.replace(/href="([^"]+)"/g, (whole, href: string) => {
    const bare = href.replace(/^\.\//, "").replace(/^docs\//, "").split("#")[0];
    const anchor = href.includes("#") ? `#${href.split("#")[1]}` : "";
    const slug = known.get(bare.toLowerCase());
    if (slug === undefined) return whole;
    return `href="/docs/${slug ? `${slug}/` : ""}${anchor}"`;
  });
}

/** Adds ids to headings so the generated pages support deep links. */
function anchorHeadings(html: string): string {
  return html.replace(/<h([2-4])>([\s\S]*?)<\/h\1>/g, (_m, level: string, inner: string) => {
    const id = inner.replace(/<[^>]+>/g, "").toLowerCase().trim()
      .replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").slice(0, 60);
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });
}

export async function buildDocPages(root: string): Promise<Page[]> {
  const docs = discoverDocs(root);
  const pages: Page[] = [];
  // Turns ```mermaid fences into SVG. Null when puppeteer cannot start, in
  // which case the fences stay as source rather than failing the build.
  const mermaid = await createMermaidRenderer();

  const nav = docs
    .map(d => `<li><a href="/docs/${docSlug(d.file) ? `${docSlug(d.file)}/` : ""}">${esc(d.icon)} ${esc(d.label)}</a></li>`)
    .join("");

  for (const doc of docs) {
    const raw = stripFrontmatter(readFileSync(doc.fullPath, "utf-8"));
    let rendered = anchorHeadings(rewriteLinks(await marked.parse(raw), docs));
    if (mermaid) rendered = await mermaid.render(rendered);
    const slug = docSlug(doc.file);
    const path = `/docs/${slug ? `${slug}/` : ""}`;

    // First real paragraph, as a description when frontmatter has no desc.
    const firstPara = raw.split(/\n\s*\n/).find(p => p.trim() && !p.trim().startsWith("#"))?.trim() ?? "";
    const description = (doc.desc || firstPara).replace(/[#*`[\]]/g, "").slice(0, 180);

    const body = `
<h1>${esc(doc.label)}</h1>
${doc.desc ? `<p class="lede">${esc(doc.desc)}</p>` : ""}
<div class="doc scroll">
${rendered}
</div>
<h2>All documentation</h2>
<ul class="grid">${nav}</ul>
`.trim();

    pages.push({
      path,
      priority: slug ? 0.6 : 0.8,
      noindex: NOINDEX.has(doc.file),
      html: shell({
        title: `${doc.label} | frogConvert docs`,
        description: description || `${doc.label}, frogConvert documentation.`,
        path,
        crumbs: [
          { name: "frogConvert", path: "/" },
          { name: "Docs", path: "/docs/" },
          ...(slug ? [{ name: doc.label, path }] : []),
        ],
        noindex: NOINDEX.has(doc.file),
        jsonLd: [{
          "@context": "https://schema.org",
          "@type": "TechArticle",
          headline: doc.label,
          description: description || doc.label,
          url: `https://frogconvert.xyz${path}`,
          isPartOf: { "@type": "WebSite", name: "frogConvert", url: "https://frogconvert.xyz" },
        }],
        body,
      }),
    });
  }

  await mermaid?.close();
  return pages;
}
