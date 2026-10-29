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
4. **Convert** - hit **Convert**. A progress indicator shows how many files have been processed. For one HTML file to PDF in a browser, frogConvert instead offers a prepared print view first.
5. **Download** - when conversion finishes, press **Download** to save the generated file. For HTML browser printing, choose **Save as PDF** in your browser's native print dialog.

## Tips

- **Any-to-any.** frogConvert chains multiple conversion tools to reach formats no single tool supports directly. WAV to PDF? Go for it.
- **Theme toggle.** Light/dark mode button in the top bar.
- **Mode toggle (Core / Plus / All).** Controls how many output formats are shown:
  - **Core** - common everyday formats only.
  - **Plus** - adds data, font, and extra media formats.
  - **All** - every supported format.
- **Multiple files.** Use the file manager to review, add, remove, or replace individual files.
- **Partial downloads.** Cancelled a batch mid-way? You can still download the files that finished.
- **Compression while converting.** Handlers like FFmpeg, ImageMagick and pdftoimg re-encode, so a conversion is also a chance to compress the file. Pick the level under **Compression** in the hamburger menu: *Original quality* (default - the format changes and nothing else), *Automatic* (reads each file and picks a tier), *High quality*, *Balanced*, or *Smallest file*. The same choice is available to agents as the `quality` argument on the MCP `convert_file` tool and the REST `POST /convert` endpoint. See [INTEGRATIONS.md § Quality preset](INTEGRATIONS.md#quality-preset) and [COMPRESS.md](COMPRESS.md).
- **Picking the same format in and out does nothing, on purpose.** The Converter changes the format; it does not re-encode a file into itself. Choosing JPG to JPG hands back your original bytes with a *"No conversion needed"* notice, and the button relabels to **Download original** so you know before you press it. The format picker signposts the alternative - *"Same format in and out, so there's nothing to convert. Want it smaller?"* - with an **Open Compress** button that carries the files across. Making a file smaller is [Compress](COMPRESS.md)'s job, and it is better at it: batches, PDFs, per-file reporting and the keep-threshold all live there. (Earlier builds did compress inline here, which is why the option existed at all.)
- **Smart auto-adaptation.** When a conversion would hit a browser-memory or sanity ceiling (very large PDFs, long videos to GIF, thousands of frames extracted from a long video), the pipeline adjusts the output instead of erroring. Adjustments are explained in a post-conversion notice card. See [HANDLERS.md § Post-conversion notices](HANDLERS.md#post-conversion-notices) for how handlers emit these.
- **Performance.** frogConvert detects available RAM and adjusts limits to prevent crashes on lower-end devices.

## PostScript, EPS and Illustrator

Ghostscript - the same engine that powers PDF compression - reads the PostScript family natively, so these routes keep vector content as vector: text stays selectable and curves stay curves.

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

- **`.ai` files convert through their PDF layer.** Illustrator has written PDF-compatible `.ai` since version 9 (2000), so the artwork comes across intact - but layers, editable text and effects are flattened. Keep the `.ai` as your master. The Converter says so before you press the button.
- **The engine is a ~16 MB download**, fetched the first time you use a PostScript route (or compress a PDF) and cached afterwards. It is never fetched at page load.

## Known limitations

- **PDF input on Safari.** Safari's JavaScript engine cannot handle PDF input for conversions (PDF to PNG, PDF to TXT, etc.). Use Chrome or Firefox for PDF input. Other formats work normally on Safari.
- **Office documents (DOCX, PPTX, XLSX, ODT, ODP, ODS) to PDF.** A faithful PDF needs [LibreOffice](https://www.libreoffice.org/). The desktop app uses it when it is installed on the computer (restart the app after installing), and so do the command-line tools, MCP server and REST API (see [INTEGRATIONS.md](INTEGRATIONS.md)). In supported browsers on desktop and mobile, the Converter offers the **browser Office engine**: LibreOffice compiled to WebAssembly, a one-time download of about 74 MB that stays on the device (Cache Storage, so clearing site data removes it). After it, DOCX, PPTX, XLSX, ODT, ODP and ODS become real PDFs with selectable text, a few seconds each, nothing uploaded. It needs about 1.5 GB of working memory, cross-origin isolation and modern browser features. Touchscreens are not excluded, but mobile browsers may terminate memory-intensive conversions. The engine is downloaded only when requested, not on page load. Without it, and in the desktop app without LibreOffice, the PDF is a picture of the document: not selectable, and slide layouts and images may be lost. The Converter asks you to install the engine before a normal conversion, offers a separate limited-conversion action when needed, and labels degraded output clearly. Legacy `.doc` and `.ppt` are not supported in the browser: the engine hangs on them, so it does not take them.
- **HTML to PDF, one file in a web browser.** **Convert** prepares a sandboxed print view and offers **Save PDF**. Your browser's native print dialog then handles saving a PDF with selectable text where the source has text. The HTML's own `@page`/print styles take precedence; A4 with 10 mm margins is the fallback. The browser dialog may vary by device, and closing it does **not** prove a PDF was saved. If the PDF options cannot open, choose **Try again**. This flow does not offer a picture-only downgrade. Nothing is uploaded.
- **Other HTML and Markdown conversions.** HTML to PNG, batched HTML to PDF, and Markdown to PDF continue through the existing converter. Images are laid out at 1024 CSS px; image-based PDFs use A4 pages and attempt to cut between lines. For HTML/Markdown-derived image PDFs, the result may still offer **Print as PDF** when a printable document is available. The desktop app and MCP/REST Chromium bridge can print HTML to PDFs with real text directly. External stylesheets, web fonts and images are not fetched; interactive JavaScript is not executed. Pages depending on those resources may look different, even through native printing.
- **Lossy routes are labelled.** When the only route to a document format passes through an image (a PDF to DOCX or PPTX arrives as one picture per page) or through plain text, the result says so. See [src/conversion/routeQuality.ts](../src/conversion/routeQuality.ts).
- **Encrypted files** are not supported. Remove the password first.

## See also

- [PDF_EDITOR.md](PDF_EDITOR.md) - merge, reorder, extract, and watermark PDF pages.
- [INTEGRATIONS.md](INTEGRATIONS.md) - MCP and REST API for scripting conversions.
- [../SECURITY.md](../SECURITY.md) - privacy posture and threat model.
