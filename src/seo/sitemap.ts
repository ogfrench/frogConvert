// Sitemap generation. Replaces the hand-maintained public/sitemap.xml, which
// listed four URLs, omitted /convert entirely and every individual doc, and
// had no way to keep lastmod honest.

export interface SitemapEntry {
  path: string;
  priority: number;
  changefreq?: string;
}

export function buildSitemap(entries: SitemapEntry[], lastmod: string, site = "https://frogconvert.xyz"): string {
  const urls = entries
    .slice()
    .sort((a, b) => b.priority - a.priority || a.path.localeCompare(b.path))
    .map(e => `  <url>
    <loc>${site}${e.path}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${e.changefreq ?? "monthly"}</changefreq>
    <priority>${e.priority.toFixed(1)}</priority>
  </url>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}
