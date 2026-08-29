<!--
Body for the GitHub Release, passed to softprops/action-gh-release as
`body_path` in .github/workflows/electron.yml.

It exists because the release body is otherwise whatever
`generate_release_notes` produces, so recutting a tag silently replaced
hand-written notes with a bare "What's Changed" list. Keep this file in step
with the version being tagged; the generated PR list is appended below it
automatically, so do not paste one here.
-->

## What's new in 3.0.0

**Compression is now a first-class feature, not a hidden default.** A new **Compress** mode at `/compress` lets you drop a mixed batch of images, audio, video and PDFs, pick a level, and download, with per-file and total savings shown up front. PDFs compress for real now via Ghostscript-WASM (text stays text, unlike the old canvas-based route), and the release also adds PostScript/EPS/Illustrator conversion, Image → PDF, cancellable PDF edits, and live progress bars on every long-running conversion.

Compression is also available over MCP, REST and CLI (`POST /compress`, `compress_file`), including video and audio via a headless-browser fallback.

## Also in this recut

**The documentation, every format and every conversion now has its own page.** 118 prerendered pages: one per document at `/docs/<slug>/`, 45 format hubs at `/formats/<ext>/`, 59 conversion guides at `/convert/<from>-to-<to>/`. All 13 documents previously shared a single URL whose indexable body was the word `Loading`, because the docs app fetches its markdown at runtime. `/docs/architecture/` now serves 3,157 words with no JavaScript executed, diagrams included: those are rendered to SVG at build time rather than left as diagram source.

**Conversions that had never worked now do.** Native LibreOffice hung on every document conversion on Windows, because the user-profile URI was percent-encoded into `C%3A`, and LibreOffice does not reject that URI, it hangs on it. It also declared it could read EPUB, which it cannot, and that broke `md` to `pdf` as collateral. `pdf` to `docx` failed outside the browser because the pdf.js worker was resolved from a web path only a server can provide, so MCP, the REST API and the CLI could not do it at all. The conversion verifier goes from 44 pairs converting to 52, with nothing failing.

**The Content-Security-Policy is enforced.** `public/_headers` carries a policy with no `'unsafe-inline'` and a sha256 for every inline script, stamped in at build time. It had never been applied, because `netlify.toml` declared its own CSP for `/*` and that takes precedence, so the permissive one shipped on every path. Measured on a deploy preview across eight paths, before and after: 0 hashes with `'unsafe-inline'` present, then 5 hashes with `'unsafe-inline'` gone, and nothing blocked.

**`pdf` to `txt` runs natively under MCP again.** The pdf.js worker was resolved by its path inside the pdf-parse package, but the package's `exports` map does not expose that path, so the resolve was blocked, the handler was left unregistered, and every `pdf` to `txt` fell back to the browser bridge without saying so.

**Returning visitors get the current format list.** The cached registry carried no build identity, so a browser that stored it once kept using it after a release added formats.

**Returning visitors get a working app after a deploy.** The service worker precached the entry HTML and none of the JavaScript it names, so after a release the cached HTML asked for hashed chunks the deploy had deleted; the SPA fallback answered them with `200 text/html`, that HTML was cached under the `.js` URL, and the page rendered fully while bound to nothing — recoverable only by clearing site data. The app shell is now precached atomically: the entry chunks, their static-import closure and the two workers land in the same versioned precache as the HTML that names them, and the build fails if any of them is missing. Missing build output now returns 404 instead of falling through to the SPA rule, no cache will store an HTML body under a URL that does not name a document, and two guarded recovery paths purge and reload once if a lazy chunk still goes missing.

---

## About frogConvert

frogConvert is a universal file converter, compressor and PDF editor that runs entirely in your browser. Convert between 70+ formats, compress images, audio, video and PDFs, or edit PDFs, all without a single byte leaving your machine, and drive the same engine from AI agents and scripts through the MCP server or the local REST API.

### Convert anything to anything
- 70+ file formats across images, audio, video, documents and more.
- A routing engine (shortest path over the format graph) chains conversions automatically, so it can get from A to B even when there is no direct converter, picking the best route for you.

### Compress without losing what matters
- A dedicated Compress mode for images, audio, video and PDFs, with per-file savings shown before you download.
- Real PDF compression via Ghostscript-WASM: text stays text, not rasterized into an image.
- Never worse: a re-encode that saves less than 2% is discarded and you keep the original.

### Built-in PDF editor
- Merge, reorder, extract pages, and watermark PDFs, all in the same tool.

### Private by design
- Everything runs client-side in the browser. Files are never uploaded to a server, so nothing is stored, logged, or sent anywhere.

### For agents and scripts
- MCP server: clone the repo and run `bun run mcp`, exposing conversion, compression and PDF editing as tools to AI agents.
- Local REST API: `bun run api`, the same engine behind a simple HTTP interface for scripts and automation.

### Run it your way
- Use it in the browser, self-host it, run it in Docker, or build it as a desktop app.

### Built on
- TypeScript, Vite, and a Vitest + Puppeteer test suite.
- Ghostscript, ImageMagick, FFmpeg, Pandoc, pdf-lib and pdf.js do the heavy lifting; the full list is in the README.
- A fork of "Convert to it!" by p2r3, whose conversion pipeline frogConvert inherits and builds on. **Compress and the PDF editor are frogConvert originals**, neither exists upstream, as are the MCP server, the REST API and the test suite.

### No warranty
frogConvert is a hobby project, provided as is, with no warranty and no security audit. See [SECURITY.md](https://github.com/ogfrench/frogConvert/blob/master/SECURITY.md).
