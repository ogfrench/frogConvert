// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FormatGraph, type FormatCache } from "./graph.ts";
import { buildLandingPages, formatsIndexPage, canonicalToken } from "./pages.ts";
import { FORMAT_CONTENT, PAIR_CONTENT, FORMAT_ALIASES } from "./content.ts";
import { buildSitemap } from "./sitemap.ts";
import { parseFrontmatter, stripFrontmatter, docSlug, discoverDocs } from "./docs.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const cache = JSON.parse(readFileSync(resolve(ROOT, "public/cache.json"), "utf-8")) as FormatCache;
const graph = FormatGraph.fromCache(cache);

describe("content matches the live registry", () => {
  // The point of this file. cache.json is a generated artifact that has drifted
  // silently before (see test/formatCache.test.ts), and a landing page for a
  // route that no longer exists promises a conversion that will fail.
  it("every pair with a page is routable", () => {
    const unroutable = Object.keys(PAIR_CONTENT).filter(key => {
      const [from, to] = key.split("→").map(canonicalToken);
      return graph.route(from, to) === null;
    });
    expect(unroutable).toEqual([]);
  });

  it("every format with a hub can be read or written", () => {
    const dead = Object.keys(FORMAT_CONTENT).filter(t => !graph.canRead(t) && !graph.canWrite(t));
    expect(dead).toEqual([]);
  });

  it("every pair token has a format blurb, so no page links to a missing hub", () => {
    const tokens = new Set(Object.keys(PAIR_CONTENT).flatMap(k => k.split("→").map(canonicalToken)));
    const missing = [...tokens].filter(t => !FORMAT_CONTENT[t]);
    expect(missing).toEqual([]);
  });

  it("does not give an alias its own page, which would duplicate content", () => {
    const aliased = Object.keys(FORMAT_ALIASES).filter(a => FORMAT_CONTENT[a]);
    expect(aliased).toEqual([]);
  });

  it("builds in strict mode without throwing", () => {
    expect(() => buildLandingPages(graph, { strict: true })).not.toThrow();
  });
});

describe("generated pages", () => {
  const { pages, warnings } = buildLandingPages(graph, { strict: true });

  it("produces a page per pair plus a hub per format", () => {
    expect(pages.length).toBe(Object.keys(PAIR_CONTENT).length + Object.keys(FORMAT_CONTENT).length);
    expect(warnings).toEqual([]);
  });

  it("claims WebAssembly only for engines that are actually WebAssembly", () => {
    // The browser canvas is a native API and pdf.js, JSZip and pdf-lib are
    // plain JavaScript. Appending "compiled to WebAssembly" to every engine
    // label put a false claim on a third of the conversion pages.
    const notWasm = ["the browser canvas", "pdf.js", "JSZip", "pdf-lib",
      "pdf-parse", "ImageTracer", "fontkit", "the built-in text encoder",
      "the built-in JSON converter"];
    for (const page of pages) {
      for (const label of notWasm) {
        expect(page.html, `${page.path} claims ${label} is WebAssembly`)
          .not.toContain(`${label}, compiled to WebAssembly`);
      }
    }
  });

  it("never prints a raw internal handler name as an engine", () => {
    // These are registry identifiers, not product names. meyda is the sharpest
    // case: it declares image formats so it can render waveforms, which is true
    // of the graph and wrong about the app.
    const internals = ["meyda", "renamezip", "renametxt", "renamejson",
      "PdfCanvasCompress", "svgForeignObject", "htmlEmbed", "qoa-fu",
      "miditextcodec", "aperturePicture", "celariaMap", "fromjson", "tojson"];
    for (const page of pages) {
      const facts = page.html.match(/<dd>[^<]*<\/dd>/g) ?? [];
      for (const name of internals) {
        // Word-bounded: "Link targets are dropped" must not read as `tar`.
        const re = new RegExp(String.raw`\b${name}\b`);
        const leaked = facts.filter(f => re.test(f));
        expect(leaked, `${page.path} names ${name}`).toEqual([]);
      }
    }
  });

  it("emits no executable script, so nothing needs a CSP hash", () => {
    // Landing pages are deliberately script-free: a wrong sha256 in _headers
    // fails silently, blocking the script while the build reports success.
    for (const p of pages) {
      expect(p.html, p.path).not.toMatch(/<script(?! type="application\/ld\+json")/);
    }
  });

  it("gives every page a self-referencing canonical", () => {
    for (const p of pages) {
      expect(p.html, p.path).toContain(`<link rel="canonical" href="https://frogconvert.xyz${p.path}">`);
    }
  });

  it("carries enough prose to not read as a thin doorway page", () => {
    for (const p of pages) {
      const text = p.html
        .replace(/<(script|style)[\s\S]*?<\/\1>/g, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ").trim();
      expect(text.split(" ").length, p.path).toBeGreaterThan(200);
    }
  });

  it("says a read-only format cannot be written", () => {
    // HEIC is readable and has no writer anywhere in the registry.
    const heic = pages.find(p => p.path === "/formats/heic/")!;
    expect(heic.html).toContain("read-only");
    expect(pages.some(p => p.path === "/convert/jpg-to-heic/")).toBe(false);
  });

  it("links each pair page into the converter with the target preselected", () => {
    const page = pages.find(p => p.path === "/convert/heic-to-jpg/")!;
    expect(page.html).toContain('href="/convert?from=heic&amp;to=jpg"');
  });

  it("names the engine the app would actually pick", () => {
    // Not "meyda", which declares image formats for waveform rendering and
    // would be true of the graph but wrong about the app.
    const page = pages.find(p => p.path === "/convert/png-to-jpg/")!;
    expect(page.html).not.toContain("meyda");
  });

  it("gives every page a unique path", () => {
    const paths = [...pages.map(p => p.path), formatsIndexPage(graph).path];
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("escapes JSON-LD so a payload cannot close the block early", () => {
    for (const p of pages) {
      const blocks = p.html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
      for (const b of blocks) expect(b.slice(0, -9)).not.toContain("</script");
    }
  });
});

describe("docs", () => {
  it("parses the HTML-comment frontmatter the repo actually uses", () => {
    const fm = parseFrontmatter("<!-- docs-frontmatter\nicon: 📖\nlabel: Docs\ndesc: A thing\n-->\n# Title");
    expect(fm).toEqual({ icon: "📖", label: "Docs", desc: "A thing" });
  });

  it("parses YAML frontmatter too", () => {
    expect(parseFrontmatter("---\nlabel: X\n---\nbody")).toEqual({ label: "X" });
  });

  it("returns null when there is no frontmatter", () => {
    expect(parseFrontmatter("# Just a heading")).toBeNull();
  });

  it("strips frontmatter from the rendered body", () => {
    expect(stripFrontmatter("<!-- docs-frontmatter\nlabel: X\n-->\n# Title")).toBe("# Title");
  });

  it("gives every doc its own slug and leaves /docs/ to the docs app", () => {
    // "" would emit /docs/index.html, overwriting the docs app that
    // vite builds from docs/index.html. See docSlug.
    expect(docSlug("README.md")).toBe("readme");
    expect(docSlug("ARCHITECTURE.md")).toBe("architecture");
  });

  it("has no mermaid label that the parser rejects", () => {
    // A backslash-escaped quote inside a node label is a parse error, so the
    // diagram silently failed to render in the docs app and, before the
    // build-time renderer, shipped as raw source on the static page.
    const bad: string[] = [];
    for (const doc of discoverDocs(ROOT)) {
      const md = readFileSync(doc.fullPath, "utf-8");
      for (const m of md.matchAll(/```mermaid\n([\s\S]*?)```/g)) {
        if (m[1].includes("\\\"")) bad.push(doc.file);
      }
    }
    expect(bad).toEqual([]);
  });

  it("gives no doc an empty slug, so nothing overwrites the docs app", () => {
    const empty = discoverDocs(ROOT).filter(d => docSlug(d.file) === "");
    expect(empty.map(d => d.file)).toEqual([]);
  });

  it("discovers the documented files, README first", () => {
    const docs = discoverDocs(ROOT);
    expect(docs.length).toBeGreaterThanOrEqual(12);
    expect(docs[0].file).toBe("README.md");
  });
});

describe("sitemap", () => {
  it("emits one url per entry, highest priority first", () => {
    const xml = buildSitemap([
      { path: "/docs/", priority: 0.8 },
      { path: "/", priority: 1.0 },
    ], "2026-01-01");
    expect((xml.match(/<loc>/g) ?? []).length).toBe(2);
    expect(xml.indexOf("https://frogconvert.xyz/<")).toBeLessThan(xml.indexOf("/docs/"));
    expect(xml).toContain("<lastmod>2026-01-01</lastmod>");
  });
});
