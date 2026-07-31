<!-- docs-frontmatter
icon: 🔄
label: Converter
desc: Convert files between 70+ formats
-->

# Converter

End-user guide for the file converter side of frogConvert. For the PDF editor, see [PDF_EDITOR.md](PDF_EDITOR.md). For programmatic access, see [INTEGRATIONS.md](INTEGRATIONS.md).

## Install

frogConvert installs as an app on Windows, macOS, iOS, Android, and any Chromium browser. Look for the install icon in your address bar (or "Add to Home Screen" on iOS).

## Entry points and offline behavior

Once installed:

- **Share sheet (Android).** Long-press a file in any app and pick frogConvert from the share menu. The Converter opens with the file already loaded.
- **Share sheet (iOS).** Limited. iOS Safari does not fully support the Web Share Target API; depending on your iOS version the share menu may only launch frogConvert without auto-loading the file. Use the in-app upload zone as a fallback.
- **"Open with…"** On Windows, macOS, and ChromeOS, right-click a file and pick frogConvert. Registered for image, video, audio, PDF, text, ZIP, and 7z extensions.
- **Offline.** Conversion handlers (FFmpeg, ImageMagick, etc.) cache as you use them, so repeat conversions work without a network.
- **Resume.** Close the tab mid-conversion and frogConvert offers to **Resume** your work next time you visit. Files, target format, and selection survive the round-trip. Sessions older than 7 days are dropped automatically.

## Converting a file

1. **Upload** - drag and drop a file onto the upload zone, or click it to browse. You can upload multiple files at once (up to the device limit).
2. **Auto-detect** - frogConvert automatically detects the input format and switches the category tab to match.
3. **Pick an output** - click the format selector to open the format picker. Browse by category tab or search.
4. **Convert** - hit **Convert**. A progress indicator shows how many files have been processed.
5. **Download** - converted files download automatically.

## Tips

- **Any-to-any.** frogConvert chains multiple conversion tools to reach formats no single tool supports directly. WAV to PDF? Go for it.
- **Theme toggle.** Light/dark mode button in the top bar.
- **Mode toggle (Core / Plus / All).** Controls how many output formats are shown:
  - **Core** - common everyday formats only.
  - **Plus** - adds data, font, and extra media formats.
  - **All** - every supported format.
- **Multiple files.** Use the file manager to review, add, remove, or replace individual files.
- **Partial downloads.** Cancelled a batch mid-way? You can still download the files that finished.
- **Compression while converting.** Handlers like FFmpeg, ImageMagick and pdftoimg re-encode, so a conversion is also a chance to shrink the file. Pick the level under **Compression** in the hamburger menu: *Automatic* (default — reads each file and picks a tier), *Original quality*, *High quality*, *Balanced*, or *Smallest file*. The same choice is available to agents as the `quality` argument on the MCP `convert_file` tool and the REST `POST /convert` endpoint. See [INTEGRATIONS.md § Quality preset](INTEGRATIONS.md#quality-preset) and [COMPRESS.md](COMPRESS.md).
- **Same-format compression.** Selecting identical input and output formats (e.g. JPG to JPG, MP4 to MP4) re-encodes the file to reduce its size. A **smart size-guard** ensures you never get a "compressed" file larger than the source; if the saving is less than 2%, the original file is returned instead. For a batch, or for PDFs, use the dedicated **Compress** mode instead — see [COMPRESS.md](COMPRESS.md).
- **Smart auto-adaptation.** When a conversion would hit a browser-memory or sanity ceiling (very large PDFs, long videos to GIF, thousands of frames extracted from a long video), the pipeline adjusts the output instead of erroring. Adjustments are explained in a post-conversion notice card. See [HANDLERS.md § Post-conversion notices](HANDLERS.md#post-conversion-notices) for how handlers emit these.
- **Performance.** frogConvert detects available RAM and adjusts limits to prevent crashes on lower-end devices.

## PostScript, EPS and Illustrator

Ghostscript — the same engine that powers PDF compression — reads the PostScript family natively, so these routes keep vector content as vector: text stays selectable and curves stay curves.

| Route | Notes |
|---|---|
| `PS → PDF`, `EPS → PDF`, `AI → PDF` | The main direction. Once it is a PDF, everything else the app does with PDFs works on it: PNG/JPEG, text extraction, the PDF Editor, Compress. |
| `PDF → PS` | One PostScript file, all pages. |
| `PDF → EPS` | **One file per page.** An EPS cannot hold more than one page by definition, so a 10-page PDF gives you 10 files. |
| `PDF → PDF/A` | PDF/A-2b, for archival deposit. Anything that cannot be represented in the profile is dropped rather than failing the conversion. |
| `PDF → TIFF` | Multi-page, LZW-compressed. Resolution follows the compression level: 96 dpi at *Smallest file*, 150 at *Balanced*, 300 at *High quality*. |

**The compression level applies to these routes too.** It controls how far embedded images are downsampled, so it does nothing to a purely vector file and a great deal to a scan. Measured on a 10 MB image-heavy source:

| Route | Smallest file | Balanced | High quality |
|---|---|---|---|
| `PS → PDF` | 128 KB | 508 KB | 1.07 MB |
| `PDF → PDF/A` | 131 KB | 511 KB | 1.07 MB |
| `PDF → PS` | 3.8 MB | 16.3 MB | 16.3 MB |

Two things worth knowing:

- **`.ai` files convert through their PDF layer.** Illustrator has written PDF-compatible `.ai` since version 9 (2000), so the artwork comes across intact — but layers, editable text and effects are flattened. Keep the `.ai` as your master. The Converter says so before you press the button.
- **The engine is a ~16 MB download**, fetched the first time you use a PostScript route (or compress a PDF) and cached afterwards. It is never fetched at page load.

## Known limitations

- **PDF input on Safari.** Safari's JavaScript engine cannot handle PDF input for conversions (PDF to PNG, PDF to TXT, etc.). Use Chrome or Firefox for PDF input. Other formats work normally on Safari.
- **Office documents (DOCX, PPTX, XLSX, ODT, ODP, ODS).** Converting to PDF via LibreOffice requires [LibreOffice](https://www.libreoffice.org/) installed locally. The UI surfaces an install prompt when needed.
- **Encrypted files** are not supported. Remove the password first.

## See also

- [PDF_EDITOR.md](PDF_EDITOR.md) - merge, reorder, extract, and watermark PDF pages.
- [INTEGRATIONS.md](INTEGRATIONS.md) - MCP and REST API for scripting conversions.
- [../SECURITY.md](../SECURITY.md) - privacy posture and threat model.
