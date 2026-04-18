<!-- docs-frontmatter
icon: 📜
label: Changelog
desc: Release history
-->

# Changelog

All notable changes to frogConvert. Loosely follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

## [2.1.0] - 2026-04-18

Smart compression that adapts to what the conversion is, never dead-ends the user, and reports back when it had to adjust.

### Added
- **Same-format compression.** PNG to PNG, MP4 to MP4, MP3 to MP3 now re-encodes to reduce file size instead of passing through unchanged. A size guard falls back to the original if the result is larger or saves less than 2%.
- **"Compress" button transition.** When a compressible same-format pairing is selected, the Convert button transforms into Compress with a contextual hint.
- **Compression results in success popup.** Exact size delta shown for every compressed file (e.g. "4.2 MB to 2.1 MB, 50% smaller").
- **Post-conversion notices.** New `Notice` type on `FileData` carries messages about what the handler adapted. The UI renders each as a `.convert-notice` card using the same component as the "better handler" hints in ConvertCard.
- **Live progress on long conversions.** After 10s, elapsed time and an optional handler-supplied detail line replace the startup copy. After 20s, a rotating reassurance line appears. Handlers opt in via `onProgress?.({ detail: "..." })`; FFmpeg, pdftoimg, pdftotxt, and comics wired up.
- **Honest mid-cancel popup.** Only counts files genuinely produced. Soft-cancel copy explains the step cannot be interrupted mid-file.
- **Adaptive video-to-image sampling.** Duration-aware sampling aimed at 300 frames replaces the fixed `-r 1` default.
- **Video-to-GIF duration cap.** Low 30s / medium 60s / high 180s / lossless uncapped.
- **PDF auto-shrink.** Proportional scaling when projected megapixels exceed the 600 MP browser safety ceiling.
- **Quality preset on MCP and REST.** `convert_file` and `POST /convert` now accept an optional `quality` argument (`low`, `medium`, `high`, `lossless`). See [docs/INTEGRATIONS.md § Quality preset](docs/INTEGRATIONS.md#quality-preset).

### Changed
- **Archetype-aware image quality.** Single photos get JPEG quality 90; PDF pages get 87; video frames get 78. Medium-preset max-edge downscale threshold raised from 16 MP to 60 MP.
- **Crisper PDF pages.** Medium preset DPI raised from 144 to 160.
- **Video-to-audio quality bump.** Audio extracted one preset tier higher than the conversion request (medium stereo: 192 kbps to 256 kbps).
- **Audio channels probed.** ffprobe detects mono and picks bitrate budget accordingly.
- **Same-codec stream-copy.** MP3, AAC, and FLAC at medium/high/lossless emit `-c:a copy` instead of re-encoding.
- **Proactive sample-rate snap.** MP3/AAC/M4A encoders get `-ar <nearest-supported>` when the source rate is outside the codec whitelist.
- **Video frame resolution cap.** Extraction clamps to 1920 px (medium) or 3840 px (high) via `-vf scale`.

### Removed
- **"Try lower quality" dead-ends.** Every quality ceiling is now an adaptive degrade with a visible notice instead of an instruction the UI cannot fulfill.

## [2.0.0] - 2026-04-17

PDF Editor, 70+ formats, and a hardened core.

### Security
- Local HTTP API now validates `Origin` and `Host` headers, closing a DNS-rebinding exposure on `127.0.0.1:3000`.
- `FROGCONVERT_SANDBOX_ROOT` constrains file path arguments to a configured directory.
- POST bodies on PDF endpoints validate shape before dispatch; malformed inputs return 400.
- Archive decompression-size cap on LZH, TAR, and 7z guards against zip-bomb inputs.
- HTML-to-SVG sanitiser rewrites external URLs in `<img>`, `<link>`, `<iframe>`, and inline styles to prevent network leaks during conversion.
- LZH output sanitises entry filenames against path-traversal sequences.
- `xlsx` migrated to patched SheetJS 0.20.3, fixing prototype-pollution and ReDoS advisories.
- Netlify deploy emits a matching CSP, `Permissions-Policy`, and explicit 404s for `/api/*` and `/.well-known/*`.

### Reliability
- `initConvertButton` cleanup wrapped in `try/finally` so the `isConverting` flag resets even if cancellation throws.
- Hard-cancel safety-net: worker force-terminated if it does not acknowledge cancel within 2s.
- LibreOffice subprocess kill uses `SIGKILL` on timeout; `init()` sweeps stale temp dirs from prior crashes.
- pdfjs `pdf.destroy()` and `page.cleanup()` wrapped in `try/finally` across `pdftoimg`, `pdftotxt`, `pdfparse`.
- Global `unhandledrejection` / `error` listeners surface a recovery popup so unexpected errors never leave the UI stuck.

### Added
- **PDF Editor:** merge multiple PDFs, reorder and rotate pages, insert blanks, and extract page ranges. Runs entirely in-browser via `pdf-lib` and `pdfjs-dist`. See [docs/PDF_EDITOR.md](docs/PDF_EDITOR.md).
- **PDF editor over MCP:** `pdf_merge`, `pdf_organize`, `pdf_extract`. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).
- **PDF editor over REST:** `POST /pdf/merge`, `POST /pdf/organize`, `POST /pdf/extract`.
- **Toast component** (`src/components/Toast/`): dismissable, `aria-live` polite, info/warn/error variants.
- **Upload UX overhaul.** Unsupported files rejected upfront via dynamic `accept`, drag-reject visual, and a drop-time toast. Legacy Office formats surface a "save as .DOCX" hint.
- **Upload summary modal.** Lists added vs skipped files with per-file reason tags and an overall limit line.

### Changed
- **Structural refactor.** Conversion orchestration moved from `src/components/` into `src/conversion/`; circular-via-barrel imports eliminated.
- Format count updated to **70+** across UI, metadata, and marketing copy.
- **TraversionGraph** node lookup switched from O(N) `findIndex` to O(1) `Map.get`.
- Docs restructured into focused files: [CONVERTER.md](docs/CONVERTER.md), [HANDLERS.md](docs/HANDLERS.md), [DEPLOYMENT.md](docs/DEPLOYMENT.md), [SECURITY.md](SECURITY.md), [AGENTS.md](AGENTS.md).

### UX
- Password-protected PDFs show an actionable error instead of a generic failure popup.
- Downloaded filenames sanitised against Windows reserved names, control characters, and length limits.
- Batch warnings surfaced per-file rather than a single de-duplicated list.
- MIME type preferred over filename extension when they disagree.
- **Mobile PDF toolbar** rebuilt to a two-row layout; kebab toggles to close icon when tray is open.
- **Organize selection** unified: tap/click toggles, shift-click extends range, rAF autoscroll at viewport edges.
- Dark-mode secondary buttons now show a visible border.
- Warn toast updated to use warning-colored border and tint.
- Frogsworth gains 11 new PDF-editor quips.

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
