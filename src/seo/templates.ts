// ---------------------------------------------------------------------------
// HTML for the generated static pages
// ---------------------------------------------------------------------------
// These pages exist to be readable without JavaScript. That is the whole
// point: LLM retrieval fetchers largely do not execute JS, and a crawler that
// has to render is crawled less and later. So everything here is server-side
// string building, and the output carries no <script> at all.
//
// Script-free is also why theming is `prefers-color-scheme` only rather than
// the app's inline localStorage gate. An inline script would need its sha256
// in the CSP (public/_headers has no 'unsafe-inline' in script-src) and a
// wrong hash there fails silently, blocking the script while the build reports
// success. A visitor arriving from a search result has no stored theme anyway.

const SITE = "https://frogconvert.xyz";

export interface Crumb { name: string; path: string }

export interface ShellOptions {
  title: string;
  description: string;
  /** Site-absolute, with trailing slash, e.g. "/convert/heic-to-jpg/". */
  path: string;
  crumbs: Crumb[];
  jsonLd: unknown[];
  body: string;
  /** Set on pages that should not be indexed (the changelog, for instance). */
  noindex?: boolean;
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ESCAPES[c]);
}

/**
 * JSON-LD is injected into a <script type="application/ld+json"> block, which
 * is not executable JS and so needs no CSP hash. `<` still has to be escaped
 * or a "</script>" inside a string would close the block early.
 */
function jsonLdBlock(items: unknown[]): string {
  if (!items.length) return "";
  return items
    .map(item => `<script type="application/ld+json">\n${JSON.stringify(item, null, 2).replace(/</g, "\\u003c")}\n</script>`)
    .join("\n");
}

const CSS = `
:root{--bg:#fafafa;--fg:#18181b;--muted:#52525b;--line:#e4e4e7;--card:#fff;--accent:#15803d;--code:#f4f4f5}
@media (prefers-color-scheme:dark){:root{--bg:#0a0a0a;--fg:#fafafa;--muted:#a1a1aa;--line:#27272a;--card:#131316;--accent:#4ade80;--code:#1c1c20}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent)}
header.top{border-bottom:1px solid var(--line);padding:.85rem 1.25rem;display:flex;gap:.75rem;align-items:center}
header.top a.brand{color:var(--fg);text-decoration:none;font-weight:700;letter-spacing:-.02em}
header.top nav{margin-left:auto;display:flex;gap:1rem;font-size:.9rem}
main{max-width:52rem;margin:0 auto;padding:1.5rem 1.25rem 4rem}
nav.crumbs{font-size:.82rem;color:var(--muted);margin-bottom:1.25rem}
nav.crumbs a{color:var(--muted)}
h1{font-size:clamp(1.6rem,4vw,2.15rem);line-height:1.2;letter-spacing:-.02em;margin:0 0 .6rem}
h2{font-size:1.2rem;letter-spacing:-.01em;margin:2.2rem 0 .6rem}
h3{font-size:1rem;margin:1.5rem 0 .4rem}
p.lede{font-size:1.06rem;color:var(--muted);margin:0 0 1.5rem}
.cta{display:inline-block;background:var(--accent);color:var(--bg);text-decoration:none;font-weight:600;padding:.7rem 1.15rem;border-radius:.5rem;margin:.4rem 0 1.25rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:.6rem;padding:1rem 1.15rem;margin:1rem 0}
dl.facts{display:grid;grid-template-columns:auto 1fr;gap:.4rem 1.1rem;margin:0;font-size:.92rem}
dl.facts dt{color:var(--muted)}
dl.facts dd{margin:0}
table{border-collapse:collapse;width:100%;font-size:.92rem}
th,td{text-align:left;padding:.5rem .6rem;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-weight:600}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
figure.diagram{margin:1.25rem 0;padding:1rem;background:#fff;border:1px solid var(--line);border-radius:.6rem}
figure.diagram svg{max-width:100%;height:auto;display:block;margin:0 auto}
code{background:var(--code);padding:.12em .38em;border-radius:.25rem;font-size:.9em}
ul.grid{list-style:none;padding:0;margin:.5rem 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(8.5rem,1fr));gap:.5rem}
ul.grid a{display:block;border:1px solid var(--line);border-radius:.45rem;padding:.45rem .6rem;text-decoration:none;font-size:.9rem;background:var(--card)}
footer{border-top:1px solid var(--line);margin-top:3rem;padding:1.25rem;text-align:center;color:var(--muted);font-size:.85rem}
.faq dt{font-weight:600;margin-top:1rem}
.faq dd{margin:.3rem 0 0;color:var(--muted)}
/* Dedicated AI plugin documentation composition, matching the SPA hierarchy. */
.doc .ai-plugins{margin:1rem 0}
.doc .ai-intro{background:var(--code);border:1px solid var(--line);border-radius:1rem;padding:clamp(1.35rem,4vw,2.6rem)}
.doc .ai-intro-topline,.doc .ai-overline{font-size:.73rem;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);font-weight:650}
.doc .ai-intro-mark{display:inline-block;background:var(--accent);width:.55rem;height:.55rem;border-radius:50%;margin-right:.5rem}
.doc .ai-intro-lead{font-weight:750;letter-spacing:-.04em;line-height:1.1;font-size:clamp(1.8rem,5vw,2.7rem);margin:.9rem 0 .6rem}
.doc .ai-intro-copy{max-width:34rem;color:var(--muted)}
.doc .ai-intro-rail{display:flex;flex-wrap:wrap;gap:.4rem 1rem;padding-top:1rem;border-top:1px solid var(--line);font-size:.78rem}
.doc .ai-status{display:flex;gap:.7rem;align-items:flex-start;border:1px solid var(--line);padding:.9rem 1.1rem;border-radius:.7rem;margin:1rem 0 2.5rem;font-size:.85rem}
.doc .ai-status-indicator{background:var(--muted);border-radius:50%;width:.5rem;height:.5rem;flex:0 0 auto;margin-top:.5rem}
.doc .ai-status p,.doc .ai-section-heading>p,.doc .ai-client-description,.doc .ai-capability p,.doc .ai-safety-grid p,.doc .ai-endnote p{color:var(--muted)}
.doc .ai-section-heading{margin:2.6rem 0 1.15rem}
.doc .ai-section-heading h2{font-size:1.65rem;letter-spacing:-.025em;margin:.4rem 0 .55rem}
.doc .ai-section-heading>p{font-size:.9rem}
.doc .ai-client-grid,.doc .ai-capability-grid,.doc .ai-safety-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.85rem}
.doc .ai-client{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:1rem;padding:1.3rem;background:var(--card)}
.doc .ai-client-upper{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem}
.doc .ai-client-symbol{display:grid;place-items:center;background:var(--code);border:1px solid var(--line);border-radius:.65rem;width:2.55rem;height:2.55rem;font-weight:750;font-size:1.2rem}
.doc .ai-client-phase{color:var(--muted);font-size:.72rem;text-align:right}
.doc .ai-client h3{margin:.9rem 0 .25rem;font-size:1.35rem}
.doc .ai-client-description{font-size:.87rem;line-height:1.5}
.doc .ai-client-specs{list-style:none;padding:0;margin:.25rem 0 1.15rem}
.doc .ai-client-specs li{margin:.5rem 0;font-size:.83rem}
.doc .ai-client-specs li:before{content:"· ";color:var(--accent);font-weight:800}
.doc .ai-client-footer{display:flex;align-items:center;flex-wrap:wrap;gap:.8rem;border-top:1px solid var(--line);padding-top:1rem;margin-top:auto}
.doc .ai-client-action{background:var(--fg);color:var(--bg);border-radius:.55rem;padding:.6rem .9rem;text-decoration:none;font-size:.82rem;font-weight:650}
.doc .ai-client-secondary,.doc .ai-under-cards{font-size:.8rem}
.doc .ai-capability{display:flex;gap:.9rem;padding:1.05rem;border:1px solid var(--line);border-radius:.7rem}
.doc .ai-capability-index{font:600 .72rem monospace;color:var(--muted)}
.doc .ai-capability h3{margin:0 0 .3rem}
.doc .ai-capability p{font-size:.83rem;line-height:1.55;margin:0}
.doc .ai-prompt-showcase{background:var(--fg);color:var(--bg);padding:1.5rem;border-radius:1rem;margin:1.5rem 0 2rem}
.doc .ai-prompt-heading{display:flex;justify-content:space-between;font-size:.7rem;letter-spacing:.08em;opacity:.7}
.doc .ai-prompt-showcase blockquote{border:0;padding:0;margin:1rem 0;font-size:1.35rem;line-height:1.4}
.doc .ai-prompt-showcase>p{font-size:.8rem;opacity:.75}
.doc .ai-install-note,.doc .ai-endnote{background:var(--code);padding:1rem;border-left:3px solid var(--accent);border-radius:.35rem;margin:1rem 0}
.doc .ai-safety-grid>div{border:1px solid var(--line);border-radius:.65rem;padding:1rem}
.doc .ai-safety-grid p{font-size:.83rem;margin:.25rem 0 0}
.doc .ai-endnote p{margin:.25rem 0 0}
@media(max-width:650px){.doc .ai-client-grid,.doc .ai-capability-grid,.doc .ai-safety-grid{grid-template-columns:1fr}.doc .ai-intro{padding:1.35rem}}
`.trim();

export function shell(o: ShellOptions): string {
  const canonical = `${SITE}${o.path}`;
  const crumbHtml = o.crumbs
    .map((c, i) => i === o.crumbs.length - 1
      ? `<span>${esc(c.name)}</span>`
      : `<a href="${esc(c.path)}">${esc(c.name)}</a>`)
    .join(" &rsaquo; ");

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: o.crumbs.map((c, i) => ({
      "@type": "ListItem", position: i + 1, name: c.name, item: `${SITE}${c.path}`,
    })),
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${canonical}">
<meta name="robots" content="${o.noindex ? "noindex, follow" : "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"}">
<link rel="icon" href="/favicon.ico" type="image/x-icon">
<link rel="apple-touch-icon" href="/apple-touch-icon-180.png">
<meta name="theme-color" content="#fafafa" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="frogConvert">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:image" content="${SITE}/social-preview.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(o.title)}">
<meta name="twitter:description" content="${esc(o.description)}">
<meta name="twitter:image" content="${SITE}/social-preview.png">
<style>${CSS}</style>
${jsonLdBlock([breadcrumbLd, ...o.jsonLd])}
</head>
<body>
<header class="top">
  <a class="brand" href="/">frogConvert</a>
  <nav>
    <a href="/convert">Converter</a>
    <a href="/compress">Compress</a>
    <a href="/pdf">PDF</a>
    <a href="/docs/">Docs</a>
  </nav>
</header>
<main>
<nav class="crumbs" aria-label="Breadcrumb">${crumbHtml}</nav>
${o.body}
</main>
<footer>
  <p>frogConvert converts files entirely in your browser. Nothing is uploaded.<br>
  <a href="https://github.com/ogfrench/frogConvert">Source on GitHub</a> &middot; <a href="/docs/">Documentation</a></p>
</footer>
</body>
</html>`;
}

/** Renders a definition-list FAQ plus the matching FAQPage JSON-LD. */
export function faq(items: Array<{ q: string; a: string }>): { html: string; ld: unknown } {
  const html = `<h2>Common questions</h2>\n<dl class="faq">\n${items
    .map(i => `<dt>${esc(i.q)}</dt>\n<dd>${esc(i.a)}</dd>`)
    .join("\n")}\n</dl>`;
  const ld = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map(i => ({
      "@type": "Question",
      name: i.q,
      acceptedAnswer: { "@type": "Answer", text: i.a },
    })),
  };
  return { html, ld };
}
