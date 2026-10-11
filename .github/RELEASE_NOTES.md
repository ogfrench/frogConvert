<!--
Body for the GitHub Release, passed to softprops/action-gh-release as
`body_path` in .github/workflows/electron.yml.

It exists because the release body is otherwise whatever
`generate_release_notes` produces, so recutting a tag silently replaced
hand-written notes with a bare "What's Changed" list. Keep this file in step
with the version being tagged; the generated PR list is appended below it
automatically, so do not paste one here.
-->

## What's new in 3.0.2

**The desktop app makes an exact PDF from Office files when LibreOffice is installed.** Until now the desktop app drew PowerPoint, Word and Excel files as a picture, even on a computer with LibreOffice, because the app's window cannot start other programs. It now hands them to your installed LibreOffice, so a deck comes out one page per slide with real, selectable text. Without LibreOffice, the app tells you to install it and restart.

**PDF to PowerPoint keeps every page.** A 4-page PDF became 2 slides, one of them empty. Each page is now its own slide.

**Spreadsheets convert properly.** Excel files written by Python tools (openpyxl, pandas) failed or lost their text; they now read like any other. Excel to CSV and Excel to JSON return your cells rather than an internal document tree. CSV to JSON no longer drops the last row, and JSON to CSV keeps your column order.

**Results say when they are pictures.** In the browser, which has no Office engine, Office to PDF draws the document as an image, and PDF to Word or PowerPoint brings each page across as a picture. The Converter now says so before you convert and on the result, instead of calling it a plain success or suggesting a LibreOffice install that cannot help in a browser.

For everything new in 3.0, see the [3.0.0 release](https://github.com/ogfrench/frogConvert/releases/tag/v3.0.0). Full history in [CHANGELOG.md](https://github.com/ogfrench/frogConvert/blob/master/CHANGELOG.md).

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
frogConvert is provided as is, with no warranty and no security audit. See [SECURITY.md](https://github.com/ogfrench/frogConvert/blob/master/SECURITY.md).
