<!-- docs-frontmatter
icon: 📜
label: Changelog
desc: Release history
-->

# Changelog

All notable changes to frogConvert. Loosely follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-04-15

### Added
- **PDF Editor** (frogConvert-original, not present in the upstream [Convert to it!](https://github.com/p2r3/convert) project): a new in-browser workspace for merging multiple PDFs, reordering and rotating pages, inserting blank pages, and extracting page ranges. Toggle between **Converter** and **PDF Editor** modes from the top bar. Powered by `pdf-lib` (write) and `pdfjs-dist` (thumbnails). See [docs/PDF_EDITOR.md](docs/PDF_EDITOR.md).
- **PDF editor over MCP**: new MCP tools `pdf_merge`, `pdf_organize`, `pdf_extract`. See [docs/INTEGRATIONS.md § MCP Tools Reference](docs/INTEGRATIONS.md#mcp-tools-reference).
- **PDF editor over REST**: new endpoints `POST /pdf/merge`, `POST /pdf/organize`, `POST /pdf/extract`. See [docs/INTEGRATIONS.md § REST API Reference](docs/INTEGRATIONS.md#rest-api-reference).
- Docs restructured to be MECE: new [docs/CONVERTER.md](docs/CONVERTER.md), [docs/HANDLERS.md](docs/HANDLERS.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), and root-level [SECURITY.md](SECURITY.md). Each doc now owns one audience/purpose.
- Root-level [AGENTS.md](AGENTS.md) consolidating the agent workflow rules that previously lived at the bottom of `docs/CONTRIBUTING.md`.

### Changed
- Format count advertised as **70+** (was 50+) across UI, metadata, and marketing copy.
- Social metadata (OpenGraph, Twitter cards, JSON-LD) now advertises the PDF editor alongside the converter.
- [package.json](package.json) description updated to cover both converter and PDF editor.
- [README.md](README.md) slimmed to a landing page; feature details moved into their dedicated docs.
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) scoped to PR workflow, testing, style; handler authoring extracted to [docs/HANDLERS.md](docs/HANDLERS.md).

## [1.0.x and earlier]

Pre-changelog releases. Notable additions since forking from [Convert to it!](https://github.com/p2r3/convert):

- MCP server and REST API for AI agents ([docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)).
- Quality presets (low / medium / high / lossless) for FFmpeg, ImageMagick, pdftoimg.
- LibreOffice handler for DOCX/PPTX/XLSX to PDF.
- Soft cancel and partial downloads for batch conversions.
- Format Mode system (Core / Plus / All).
- Frame extraction for animated formats and videos.
- ICO multi-size bundles.
- Web Worker offloading for heavy conversions and route finding.
- Frogsworth mascot.
- Full Vitest + Puppeteer test suite.
