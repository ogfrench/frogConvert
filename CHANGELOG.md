<!-- docs-frontmatter
icon: 📜
label: Changelog
desc: Release history
-->

# Changelog

All notable changes to frogConvert. Loosely follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-04-17

Headline: frogConvert **2.0.0** is here — transform your PDFs with the new **PDF Editor**, convert **70+ formats**, and enjoy a **proactive UX** built on a hardened, battle-tested core.

### Security
- Local HTTP API (`bun x frogconvert api`) now validates `Origin` / `Host` headers and rejects cross-origin requests — closes a DNS-rebinding exposure where a page the user visits could POST to `127.0.0.1:3000`.
- `FROGCONVERT_SANDBOX_ROOT` env var constrains `filePath` / `outputFilePath` / `outputDir` arguments to a configured directory (defense-in-depth; loopback-only remains the primary guard).
- POST bodies on `/pdf/merge`, `/pdf/organize`, `/pdf/extract` now validate shape before dispatch; malformed inputs return 400 instead of crashing deep.
- Archive decompression-size cap on LZH, TAR, and 7z handlers — protects against zip-bomb inputs that would exhaust the browser WASM heap.
- `svgForeignObject` HTML→SVG sanitiser now rewrites external `http(s)://` URLs in `<img>`, `<link>`, `<iframe>`, `srcset`, inline styles, and `<style>` blocks, so converting untrusted HTML no longer leaks network requests to third-party origins during bounding-box measurement.
- LZH→ZIP output sanitises entry filenames against path-traversal sequences.
- Netlify deploy now emits a matching CSP, `Permissions-Policy`, and explicit 404s for `/api/*` and `/.well-known/*` (previously fell through to SPA `index.html`).
- Electron renderer: added `sandbox: true` alongside the existing `contextIsolation`/`nodeIntegration:false` baseline.
- `xlsx` migrated to the patched SheetJS CDN tarball (0.20.3) — fixes prototype-pollution and ReDoS advisories on the XLSX parser path.
- Production sourcemaps emitted as `hidden` (maps still uploadable to error trackers; no inline reference shipped).
- `bun audit --level high` wired as a new `audit` npm script.

### Reliability
- `initConvertButton` cleanup wrapped in a nested try/finally so the `isConverting` flag and UI state reset even if `completeCancellation()` throws — eliminates "stuck at Converting…" dead ends.
- Hard-cancel safety-net: if the worker doesn't acknowledge a cancel within 2 s, the force-cleanup path now terminates the worker and returns the UI to idle.
- LibreOffice subprocess kill uses `SIGKILL` on timeout (previously `SIGTERM`, which a hung soffice can ignore); handler `init()` sweeps stale `libreoffice-node-*` temp dirs from prior crashes.
- pdfjs `pdf.destroy()` + `page.cleanup()` wrapped in `try/finally` across `pdftoimg`, `pdftotxt`, `pdfparse` — prevents worker-side memory pinning when a page throws mid-parse.
- Three.js geometry, material, and texture `dispose()` runs after each render in `threejs` handler — fixes long-session GPU memory accumulation.
- `browserBridge` signal-handler registration flag anchored on `globalThis` so HMR / duplicate module instantiation no longer double-registers process exit handlers.
- Worker reference cleared on bfcache restore (`pageshow` listener) so the first post-restore conversion re-spawns instead of posting to a zombie worker.
- Global `unhandledrejection` / `error` listeners now surface a recovery popup with a Reload button so an unexpected error never leaves the UI silently stuck.

### UX
- Password-protected PDFs show a dedicated, actionable error ("Decrypt it with Adobe Acrobat or similar, then upload again") instead of a generic "Conversion failed" popup.
- Downloaded filenames sanitised against Windows reserved names (`CON`, `NUL`, `PRN`, `COM1–9`, `LPT1–9`), control chars, NUL bytes, trailing dots/spaces, and length > 200 chars; ZIP entries deduplicated on collision.
- Batch warnings surfaced per-file (or as "all N files" when universal) instead of one flat de-duplicated list.
- MIME type preferred over filename extension when they disagree; names without an extension no longer accidentally match a format with that whole name.
- `localStorage.setItem` sites wrapped against `QuotaExceededError` — a full storage quota no longer breaks page init.
- Thumbnail render queue serialised so concurrent callers no longer race on the shared canvas.
- Archive-bomb rejection uses neutral sizing language ("exceeds the N MB safety cap") rather than accusatory phrasing.

### Developer experience
- Three copy-paste clusters extracted into shared helpers: `src/handlers/_archiveGuard.ts`, `src/handlers/_pdfErrors.ts`, and `safeLocalStorageSet` in `src/components/utils/`.
- jsdom canvas `getContext` stub added to `test/setup.ts` — fixes the Confetti test and unblocks future canvas-touching tests.
- Four new tests for the hard-cancel timer and cancel-then-reconvert state reset in `src/conversion/cancellation.dom.test.ts`.

Structural-refactor + PDF-editor details follow.

### Added
- **PDF Editor** (frogConvert-original, not present in the upstream [Convert to it!](https://github.com/p2r3/convert) project): a full in-browser workspace for merging multiple PDFs, reordering and rotating pages, inserting blank pages, and extracting page ranges. Toggle between **Converter** and **PDF Editor** modes from the top bar. Powered by `pdf-lib` (write) and `pdfjs-dist` (thumbnails). See [docs/PDF_EDITOR.md](docs/PDF_EDITOR.md).
- **PDF editor over MCP**: new MCP tools `pdf_merge`, `pdf_organize`, `pdf_extract`. See [docs/INTEGRATIONS.md § MCP Tools Reference](docs/INTEGRATIONS.md#mcp-tools-reference).
- **PDF editor over REST**: new endpoints `POST /pdf/merge`, `POST /pdf/organize`, `POST /pdf/extract`. See [docs/INTEGRATIONS.md § REST API Reference](docs/INTEGRATIONS.md#rest-api-reference).
- **Toast component** (`src/components/Toast/`): dismissable, `aria-live` polite, info/warn/error variants. Used across the PDF workspace and upload flow.
- Docs restructured to be MECE: new [docs/CONVERTER.md](docs/CONVERTER.md), [docs/HANDLERS.md](docs/HANDLERS.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), and root-level [SECURITY.md](SECURITY.md). Each doc now owns one audience/purpose.
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
