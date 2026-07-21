## What's new in 2.5.0

**Zip download names are now unique and describe what's inside.** Exporting the same batch twice used to hand the browser an identically named archive, so it either silently overwrote your previous download or tacked on `(1)`, `(2)`. Every multi-file zip — from both the converter and the PDF editor — now carries a compact, sortable timestamp, and multi-file archives are named for the operation that produced them instead of borrowing one arbitrary source file's name.

- `frogConvert-20260715-143207.zip` and `original-files-20260715-143207.zip` (converter)
- `organized-pdfs-…`, `extracted-pages-…`, `watermarked-pdfs-…`, `pdfs-…` (PDF editor)

Names use the compact ISO-8601 basic format `YYYYMMDD-HHMMSS` (the de-facto standard for machine-generated exports): unique to the second, chronologically sortable, and filesystem-safe. Single-file downloads are unchanged.

Full changelog: https://github.com/ogfrench/frogConvert/blob/master/CHANGELOG.md

---

## About frogConvert

frogConvert is a universal file converter and PDF editor that runs entirely in your browser. Convert between 70+ formats or edit PDFs without a single byte leaving your machine, and drive the same engine from AI agents and scripts through the MCP server or the local REST API.

### Convert anything to anything
- 70+ file formats across images, audio, video, documents and more.
- A routing engine (shortest path over the format graph) chains conversions automatically, so it can get from A to B even when there is no direct converter, picking the best route for you.

### Built-in PDF editor
- Merge, reorder, extract pages, and watermark PDFs, all in the same tool.

### Private by design
- Everything runs client-side in the browser. Files are never uploaded to a server, so nothing is stored, logged, or sent anywhere.

### For agents and scripts
- MCP server: `bunx frogconvert mcp` — expose conversion and PDF editing as tools to AI agents.
- Local REST API: `bunx frogconvert api` — the same engine behind a simple HTTP interface for scripts and automation.

### Run it your way
- Use it in the browser, self-host it, run it in Docker, or build it as a desktop app.

### Built on
- TypeScript, Vite, and a Vitest + Puppeteer test suite.
- A fork of "Convert to it!" by p2r3, with the original conversion pipeline retained and the UI, integrations, and PDF tooling extended.
