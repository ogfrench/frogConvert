<!-- docs-frontmatter
icon: 📜
label: Changelog
desc: Release history
-->

# Changelog

All notable changes to frogConvert. Loosely follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

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
