<!--
Body for the GitHub Release, passed to softprops/action-gh-release as
`body_path` in .github/workflows/electron.yml.

It exists because the release body is otherwise whatever
`generate_release_notes` produces, so recutting a tag silently replaced
hand-written notes with a bare "What's Changed" list. Keep this file in step
with the version being tagged; the generated PR list is appended below it
automatically, so do not paste one here.
-->

## What's new in 3.4.0

**Find any format, and a sturdier Office engine.**

- **Search finds every format.** Typing in the format list now searches Core, Core+ and All at once, whatever list you're browsing, and shows which list each result comes from. Clear the search and you're back where you were. The search box is ready to type in as soon as the list opens.
- **PowerPoint to HTML.** Slide text, tables and pictures come across.
- **A more reliable Office engine download.** The engine now downloads in checked pieces and is unpacked straight into storage, so it needs far less memory while installing. Interrupted pieces are retried, and if something fails the message says whether it was the download, unpacking or saving. In private browsing, where many browsers refuse to store the engine, you're told so before the large download starts.
- **Clearer PDF saving.** The HTML to PDF sheet tells you to pick "Save as PDF" as the printer or destination in the print window.
- **Safer handling of broken files.** A corrupt PowerPoint can no longer freeze a conversion, and an Office file that claims to be enormous can no longer make the browser reserve gigabytes of memory.

Files stay on your device. The Office engine still needs plenty of memory and may not work on every phone.

Full history in [CHANGELOG.md](https://github.com/ogfrench/frogConvert/blob/master/CHANGELOG.md).

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
