/**
 * Renders ```mermaid fences to inline SVG at build time.
 *
 * The docs app turns these into diagrams in the browser (src/docs/mermaid-renderer.ts).
 * The prerendered pages deliberately carry no executable script, so `marked`
 * left the diagram source in the page: /docs/architecture/ shipped 448 words of
 * `style U fill:#6ee7b7,stroke:#059669` as if it were prose.
 *
 * Rendering needs real layout (mermaid measures text with getBBox), which jsdom
 * does not provide, so this drives the puppeteer that is already a dependency.
 * One browser for the whole build; only ARCHITECTURE.md has diagrams today.
 *
 * The SVG is rendered once, in mermaid's light theme, and the page CSS gives
 * `figure.diagram` a light surface in both colour schemes. A single SVG cannot
 * respond to prefers-color-scheme, and a light diagram on its own light card
 * reads correctly on either background.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);

const FENCE = /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g;

const decode = (s: string): string =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
   .replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/** Strips the width/height mermaid hardcodes so the SVG scales to its column. */
const fluid = (svg: string): string =>
  svg.replace(/<svg([^>]*)\s(width|height)="[^"]*"/g, "<svg$1")
     .replace(/<svg /, '<svg preserveAspectRatio="xMidYMid meet" ');

export interface MermaidRenderer {
  render(html: string): Promise<string>;
  close(): Promise<void>;
}

/**
 * Returns a renderer, or null when puppeteer cannot start (no downloaded
 * browser, sandboxed CI). Callers fall back to leaving the fence alone: a
 * readable page without pictures beats a failed build.
 */
export async function createMermaidRenderer(): Promise<MermaidRenderer | null> {
  let browser: import("puppeteer").Browser;
  let page: import("puppeteer").Page;
  try {
    const puppeteer = (await import("puppeteer")).default;
    const mermaidSrc = readFileSync(require_.resolve("mermaid/dist/mermaid.min.js"), "utf-8");
    browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    page = await browser.newPage();
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ content: mermaidSrc });
    await page.evaluate(() => {
      (globalThis as any).mermaid.initialize({ startOnLoad: false, theme: "default" });
    });
  } catch (e) {
    console.warn(`[seo] mermaid prerender unavailable, leaving diagram source in place: ${(e as Error).message}`);
    return null;
  }

  return {
    async render(html: string): Promise<string> {
      const blocks = [...html.matchAll(FENCE)];
      if (!blocks.length) return html;

      let out = html;
      for (let i = 0; i < blocks.length; i++) {
        const source = decode(blocks[i][1]).trim();
        let svg: string;
        try {
          svg = await page.evaluate(async (src: string, id: string) => {
            const { svg } = await (globalThis as any).mermaid.render(id, src);
            return svg as string;
          }, source, `seo-diagram-${i}`);
        } catch (e) {
          // A diagram mermaid cannot parse keeps its source rather than
          // silently vanishing from the page.
          console.warn(`[seo] diagram ${i} did not render: ${(e as Error).message.split("\n")[0]}`);
          continue;
        }
        out = out.replace(blocks[i][0], `<figure class="diagram scroll">${fluid(svg)}</figure>`);
      }
      return out;
    },
    async close() { await browser.close().catch(() => undefined); },
  };
}
