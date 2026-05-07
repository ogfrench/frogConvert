<!-- docs-frontmatter
icon: 📜
label: Changelog
desc: Release history
-->

# Changelog

All notable changes to frogConvert. Loosely follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

## [2.2.1] - 2026-05-07

Bug-fix release: three Critical-class data-loss paths closed, plus power-user keyboard productivity in the PDF Editor and Format modal.

### Fixed
- **App-mode switch no longer destroys PDF workspace state.** Toggling between Converter and PDF Editor used to call `resetAll()` on the workspace, wiping loaded files, page reorder, watermark settings, and the undo history. Users who organized a long PDF and tapped the mode toggle by mistake (or to glance at the converter copy) returned to an empty workspace with no recovery. The mode-out path now calls `cleanup()` instead — DOM listeners and the body-mounted toolbar/tray are torn down, but module state is preserved. `initPdfWorkspace()` re-renders on subsequent calls so coming back remounts the UI on the existing data.
- **Success popup no longer eats your file when closed early.** The post-conversion popup launched a `setTimeout(downloadAllConvertedFiles, 400)` gated on `popupBox.classList.contains("open")`. Fast-clickers who tapped *Done* before 400 ms got confetti but no download. Blob URLs are independent of popup lifetime, so the guard was dropping the file for no reason. Removed; downloads now fire unconditionally. Confetti stays popup-anchored.
- **Files modal no longer replaces your file list when you drop on its background.** Drops anywhere on the modal except the inner *Drop more PDFs* zone bubbled to UploadZone's window-level handler, which silently called `proceedWithFiles()` and replaced `currentFiles`. Capture-phase `dragover`/`drop` listeners on the modal element now claim drops while open and route to `addMoreFiles()`.
- **Mascot apology removed from Safari PDF error popup.** The Safari-specific error message ended with `Frogsworth is sorry ₍𝄐~𝄐₎`, which violated the CLAUDE.md "no mascot catchphrases" rule inside a critical-error popup. The message already names the escape route (Chrome / Firefox); the kaomoji was noise.

### Added
- **Ctrl/Cmd+Click for non-contiguous page selection** in the PDF Editor's Organize tab. `toggleSelection()` takes a third `ctrl` flag that explicitly toggles the clicked page and overrides Shift, matching the Windows / macOS multi-select convention so power users can pick or unpick a single page without disturbing a Shift range. Plain click and Shift+Click behavior unchanged.
- **Redo (Ctrl+Y / Ctrl+Shift+Z)** in the PDF Editor. A 30-snapshot redo stack runs alongside the existing undo history. New mutating actions clear the redo branch (same convention as code editors and image tools). `cleanup()` and `resetAll()` clear both stacks.
- **Arrow-key navigation across the Format modal options.** ↓ from the search input pulls focus into the first visible option; ↑ from the first option pulls focus back into search. ↑/↓/Home/End move within the option list. Saves keyboard users ~70 Tab presses to reach the bottom of the All Formats list.

---

## [2.2.0] - 2026-05-07

Watermark tab for the PDF editor, plus a sweep of accessibility fixes across the workspace.

### Added
- **Watermark tab in the PDF Editor**: Stamp a text watermark on all pages or a custom range like `1-3, 8, 10-12`. Style controls: size, color (hex + swatch), opacity, rotation. Toggle **Repeat across page** to tile the watermark with internally-computed spacing. Live preview reflects the actual export and reserves aspect-ratio so the page renders instantly without layout shift. Helvetica-only text with character-set validation. Available in the UI, MCP (`pdf_watermark`), and REST (`POST /pdf/watermark`).
- **Shared sidebar primitives** in `PdfWorkspace.ts` (`makeSidebarFileRow`, `makeSidebarDivider`, `makeSectionLabel`) so Merge / Organize / Watermark render the file row and divider markup from one source.

### Changed
- **Watermark UI unified with Merge/Organize**: same active-file row at the top of the sidebar, same Select all / Deselect all pattern, same sticky-bottom mobile toolbar + tray drawer.
- **Watermark MCP/REST surface narrowed to text-only**: `source` discriminator and `placement` field removed from `pdf_watermark` and `POST /pdf/watermark`. `text`, `fontSize`, `colorHex` are now top-level fields; placement is always center. Image-source watermarks have been removed from the public API to match the UI.
- **Watermark UI defaults aligned with engine**: the workspace now derives `fontSize` (`80`) and `opacity` (`0.5`) from `WATERMARK_DEFAULTS` in [src/tools/pdfWatermark.ts](src/tools/pdfWatermark.ts) instead of holding its own values (previously `64` / `0.2`). UI, MCP (`pdf_watermark`), and REST (`POST /pdf/watermark`) defaults are now identical.

### Fixed
- **Combined-mode watermark output filename**: `doWatermarkExportCombined` no longer double-suffixes (e.g. `report_watermarked_watermarked.pdf` → `report_watermarked.pdf`). Now reuses `merge()` from [src/tools/pdfMerge.ts](src/tools/pdfMerge.ts) instead of an inline `PDFDocument.create()` loop.

### Accessibility
- **Watermark tab is now keyboard- and screen-reader accessible**:
  - Page cards are tabbable (`tabindex=0`), have programmatic names (`Page A1`, `Page B3`, etc.), and toggle on `Space` / `Enter` (matching the Organize tab).
  - Sliders (`Size`, `Opacity`, `Rotation`) gained a thumb-bound `:focus-visible` ring (the previous `outline: none` left keyboard users with no visible focus indicator — WCAG 2.4.7).
  - Inputs that surface error states (`Watermark text`, `Color hex`, `Page range`) now toggle `aria-invalid` alongside the existing red border. The text input is wired to its error message via `aria-describedby` so screen readers announce *why* the input is invalid.
  - The disabled `Export PDF` button is wired via `aria-describedby` to its status paragraph, so AT users hear *why* it's disabled (e.g. "Pick at least one page").
  - The `Color` row is now a `role="group"` labelled by the visible `Color` text, tying the hex field and swatch together for AT.
  - Visible labels (`Text`, `Size`, `Color`, etc.) link to their inputs via `aria-labelledby`, eliminating drift between visible and announced names.
- **PDF Workspace: cross-tab a11y improvements**:
  - The mobile **More options** tray is now a proper `role="dialog"` with an accessible name, an `Escape` close handler; focus moves into the tray on open and returns to the trigger on close.
  - Drop-zone "Add more PDFs" cards are now keyboard-activatable (`role="button"`, `tabindex=0`, `Space` / `Enter`), with a visible `:focus-visible` ring.
  - Page cards across all tabs gained an on-brand `:focus-visible` ring.
  - The internal `el()` helper now routes `role` and ARIA attributes via `setAttribute`, so the workspace no longer relies on ARIAMixin IDL reflection (patchy in older Firefox/Safari and jsdom).

### Performance
- **Watermark preview**: lazy-render observer unobserves cards after first paint (subsequent re-renders go through `wmKickVisible` directly), and the Helvetica encode probe is memoized per-text so a 300-page grid runs `font.encodeText()` once per text change instead of once per visible card.

## [2.1.3] - 2026-05-04

Error-copy normalization, quality-resolution unification, and palette-PNG encoding.

### Added
- **Unified error copy via `toUserErrorText`**: Worker crashes, password-protected files, parse failures, timeouts, and empty-output errors now map to consistent friendly messages across UI, REST API, and MCP. Title constants shared from `src/components/utils/index.ts`.
- **PDF feedback contact line**: PDF Workspace and `pdf_*` MCP tools / `/pdf/*` API surface "Still stuck, or want to share feedback? Email francois.prevot@frog.co." for non-validation failures, distinct from the format-request line on the converter side.
- **`resolveEffectiveQuality`** (`src/core/compression/resolveEffectiveQuality.ts`): API/MCP requests now match the web UI's silent same-format auto-tier-down. Cross-format requests fall back to `medium`; same-format requests probe the input and pick the next lower tier; already-minimal inputs return unchanged.
- **Palette-PNG encoding** (`src/tools/palettePng.ts`): UPNG-based indexed-palette PNG encoder. `pdftoimg.ts` and `canvasToBlob.ts` use it at low/medium presets for document-like inputs (~3–5× smaller deflate at indistinguishable visual quality).
- **`ValidationError`** in `src/mcp/core/fileInput.ts`: tagged class for caller-supplied input failures. API/MCP catch-alls surface its message verbatim; everything else flows through the friendly normalizer.

### Changed
- **Deeper theme contrast**: Dark-mode background `#0a0a0a` → `#000000` with card `#141414` → `#0a0a0a`. Light-mode card `#ffffff` → `#fdfdfd` for subtle separation from the page background.
- **Removed "in frogConvert" phrasing**: "Not in the converter yet" → "Conversion not available yet"; "isn't in frogConvert yet" → "isn't available yet". Applied across UI, REST `/path` and `/convert`, MCP `find_conversion_path` and `convert_file`, and the format modal's no-outputs message.
- **Sharpened unreadable-file copy**: "Another copy might work" → "Try re-exporting it or uploading a fresh copy."
- **Worker-crash detail**: "The conversion stumbled while processing this file." → "The converter crashed while processing this file."

## [2.1.2] - 2026-04-29

More PDF routes via LibreOffice.

### Added
- **LibreOffice now accepts HTML, RTF, TXT, CSV, and EPUB inputs**: Unlocks alternative PDF routes such as `md → html → pdf` alongside the existing `md → docx → pdf`, plus direct `txt → pdf`, `rtf → pdf`, `csv → pdf`, `html → pdf`, and `epub → pdf` when LibreOffice is available (native binary or localhost API).

## [2.1.1] - 2026-04-22

Audio-to-video uploadability and phase-aware progress UI.

### Fixed
- **Audio → video produces a real video stream**: MP3 → MP4 (and MOV, MKV, M4V, AVI, FLV, TS, MTS, WebM) now embed a bundled placeholder frame so the output is accepted by YouTube and similar platforms. Previously the container held an audio track only.

### Changed
- **Phase-aware spinner**: The pathfinding, WASM handler download, and file-reading phases now show the plain rotating spinner. The gooey spinner stays for the actual encode/compress phase so the UI reflects what the app is really doing.

## [2.1.0] - 2026-04-18

Adaptive compression and live conversion feedback.

### Added
- **Same-format compression**: Re-encodes PNG, MP4, MP3, etc. to reduce file size with a 2% safety fallback.
- **Compress button**: UI automatically switches to "Compress" when a same-format re-encode is detected.
- **Size delta reporting**: Success popups now show exact megabyte savings and percentage reductions.
- **Conversion notices**: Detailed cards explain handler adaptations (e.g., resolution caps or codec changes).
- **Live progress**: Dynamic updates showing elapsed time and handler status for conversions over 10 seconds.
- **Honest cancellation**: Interrupting a batch now reports exactly which files were finished.
- **Adaptive sampling**: Video-to-image extraction targets 300 frames based on duration instead of a fixed rate.

### Changed
- **Archetype-aware quality**: Tailored presets for photos (Q90), PDF pages (Q87), and video frames (Q78).
- **Proactive codec handling**: Skips re-encoding for compatible streams (MP3/AAC/FLAC) and snaps to supported sample rates.
- **PDF safeguards**: Auto-shrinks documents exceeding browser safety limits (600 MP).

## [2.0.0] - 2026-04-17

In-browser PDF Editor, 70+ formats, and security hardening.

### Added
- **PDF Workspace**: Merge, reorder, rotate, and extract pages entirely in-browser using `pdf-lib` and `pdfjs-dist`.
- **Extended Formats**: Expanded support to over 70 file formats across all conversion engines.
- **Upload UX**: Front-load validation with drag-reject feedback and legacy Office format hints.
- **Toast component**: Accessible, dismissable notifications for info, warnings, and errors.

### Stability
- **Security Hardening**: Origin/Host validation for local API, post-body shape checking, and sandbox constraints.
- **Resource Protection**: Archive size caps guard against zip-bombs; HTML sanitization prevents network leaks during conversion.
- **Cleanup Overhaul**: try/finally cleanup for workers, aggressive subprocess termination, and stale temp dir sweeping.
- **Recovery System**: Global error listeners surface actionable popups instead of leaving the UI stuck.

### UX & Performance
- **Unified Selection**: Standardized tap-to-toggle and shift-click range selection across mobile and desktop.
- **Batch Summaries**: Detailed modals showing added vs. skipped files with specific rejection reasons.
- **MIME Priority**: Preferred over filename extensions for more reliable format detection.
- **Performance**: TraversionGraph lookups optimized from linear time to constant time using a Map.
- **Mobile Polish**: Two-row PDF toolbar layout with a dynamic kebab tray for better accessibility.


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
