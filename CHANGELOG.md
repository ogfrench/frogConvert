<!-- docs-frontmatter
icon: 📜
label: Changelog
desc: Release history
-->

# Changelog

All notable changes to frogConvert. Loosely follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-04-15

Headline: the **full PDF Editor** lands alongside a major structural refactor of the codebase.

### Added
- **PDF Editor** (frogConvert-original, not present in the upstream [Convert to it!](https://github.com/p2r3/convert) project): a full in-browser workspace for merging multiple PDFs, reordering and rotating pages, inserting blank pages, and extracting page ranges. Toggle between **Converter** and **PDF Editor** modes from the top bar. Powered by `pdf-lib` (write) and `pdfjs-dist` (thumbnails). See [docs/PDF_EDITOR.md](docs/PDF_EDITOR.md).
- **PDF editor over MCP**: new MCP tools `pdf_merge`, `pdf_organize`, `pdf_extract`. See [docs/INTEGRATIONS.md § MCP Tools Reference](docs/INTEGRATIONS.md#mcp-tools-reference).
- **PDF editor over REST**: new endpoints `POST /pdf/merge`, `POST /pdf/organize`, `POST /pdf/extract`. See [docs/INTEGRATIONS.md § REST API Reference](docs/INTEGRATIONS.md#rest-api-reference).
- **PDF editor mobile UX polish**: Toast integration, layout refinements, CSS cleanups.
- **Toast component** (`src/components/Toast/`): dismissable, `aria-live` polite, info/warn/error variants.
- Docs restructured to be MECE: new [docs/CONVERTER.md](docs/CONVERTER.md), [docs/HANDLERS.md](docs/HANDLERS.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/PDF_EDITOR_MOBILE_UX.md](docs/PDF_EDITOR_MOBILE_UX.md), and root-level [SECURITY.md](SECURITY.md). Each doc now owns one audience/purpose.
- Root-level [AGENTS.md](AGENTS.md) consolidating the agent workflow rules that previously lived at the bottom of `docs/CONTRIBUTING.md`.

### Changed
- **Structural refactor.** Conversion-flow orchestration lifted out of `src/components/` into its own `src/conversion/` layer: `ConversionActions.ts` → `actions.ts`, `ConversionModal.ts` → `cancellation.ts`, `ConversionModal.css` → `conversion.css`; circular-via-barrel imports eliminated. `src/components/` now contains only UI components.
- **UI constants extracted** into `src/constants/ui.ts` (MOBILE_BREAKPOINT, PARALLAX_*, DEFAULT_UPLOAD_TEXT, FILES_PER_PAGE, ABSOLUTE_MAX_FILES) — previously mixed into `store.ts`.
- **Handlers loader simplified** (`src/handlers/index.ts`): `lazy()` + `pushSafe()` helpers collapse ~60 lines of near-identical boilerplate and give each handler a named failure log.
- **Tests colocated** under `src/**/*.test.ts`; `/test/` now holds only e2e, fixtures, and shared mocks.
- **`src/components/utils.ts` merged** into `src/components/utils/` folder alongside existing `ModalManager.ts`.
- **`src/core/index.ts` barrel added** for FormatHandler, TraversionGraph, CommonFormats, utils.
- Format count advertised as **70+** (was 50+) across UI, metadata, and marketing copy.
- Social metadata (OpenGraph, Twitter cards, JSON-LD) now advertises the PDF editor alongside the converter.
- [package.json](package.json) description updated to cover both converter and PDF editor.
- [README.md](README.md) slimmed to a landing page; feature details moved into their dedicated docs.
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) scoped to PR workflow, testing, style; handler authoring extracted to [docs/HANDLERS.md](docs/HANDLERS.md).

### Performance
- **TraversionGraph**: node lookup by identifier switched from O(N) `findIndex` scans to O(1) `Map.get`. Meaningful speedup at graph-init time with 70+ handlers.

### Fixed
- PDF workspace hero: "How will you shape your PDFs today?" (plural).
- Homepage meta description trimmed.

### Polish
- **Upload UX overhaul.** Unsupported files now rejected upfront via dynamic `accept` attribute, drag-reject visual, and a drop-time toast or summary modal (replaces the old post-upload dead-end popup). Legacy Office formats (.doc/.xls/.ppt) surface an actionable "save as .DOCX" hint.
- **Upload summary modal.** New read-only list of added vs skipped files with per-file reason tags (Not supported / Too large / Page limit / File limit / Not a PDF) and an overall limit line (e.g. "Limit: 200 pages total."). Replaces three separate truncation toasts.
- **Mismatch picker** disables unsupported type groups, sorts supported first, scrolls internally with a pinned footer, and shows a concrete "Save as .DOCX" hint for legacy Office formats.
- **PDF workspace limits.** Lowered to 200 pages / 500 MB total; breaches truncate gracefully instead of hard-rejecting.
- **Mobile PDF toolbar.** Rebuilt to a two-row layout (Extract · ⋮ / Export PDF full-width); kebab swaps to × when the tray is open; tray overlay now dims the hamburger menu with the same backdrop-blur as other modals.
- **Mobile tray body-scroll lock** reuses `updateScrollLock()`.
- **Organize selection.** Plain tap/click toggles (unified with mobile); shift-click extends range to cover the full current selection (no more fragmented blocks). New pointer-driven rAF autoscroll when dragging near viewport edges.
- **Filenames.** Merge/organize outputs named `*_pdfs.pdf` for clarity in downloads folder.
- **Dark-mode secondary buttons** now show a visible border (root cause: `--secondary` and `--border` resolved to the same token).
- **Warn toast styling** updated to use warning-colored border/text/tint so it actually looks like a warning.
- **Blank-page thumb** follows theme toggle via a scoped MutationObserver.
- **Thumbnail long-press / right-click** blocked on both mobile and desktop so the browser's native image menu no longer interrupts drag.
- **Frogsworth** gains 11 new PDF-editor quips.

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
