<!-- docs-frontmatter
icon: 📜
label: Changelog
desc: Release history
-->

# Changelog

All notable changes to frogConvert. Loosely follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

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
