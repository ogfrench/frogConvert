<!-- docs-frontmatter
icon: 🔄
label: Converter
desc: Convert files between 70+ formats
-->

# Converter

End-user guide for the file converter side of frogConvert. For the PDF editor, see [PDF_EDITOR.md](PDF_EDITOR.md). For programmatic access, see [INTEGRATIONS.md](INTEGRATIONS.md).

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
- **Quality presets.** Handlers like FFmpeg, ImageMagick, and pdftoimg accept low / medium / high / lossless presets. The web UI always uses `medium` (no selector on the page, by design); `low`, `high`, and `lossless` are available through the MCP `convert_file` tool and the REST `POST /convert` endpoint, both of which take an optional `quality` argument. See [INTEGRATIONS.md § Quality preset](INTEGRATIONS.md#quality-preset).
- **Same-format compression.** Selecting identical input and output formats (e.g. JPG to JPG, MP4 to MP4) re-encodes the file to reduce its size. A **smart size-guard** ensures you never get a "compressed" file larger than the source; if the saver is less than 2%, the app fallback-returns the original file.
- **Smart auto-adaptation.** When a conversion would hit a browser-memory or sanity ceiling (very large PDFs, long videos to GIF, thousands of frames extracted from a long video), the pipeline adjusts the output instead of erroring. Adjustments are explained in a post-conversion notice card. See [HANDLERS.md § Post-conversion notices](HANDLERS.md#post-conversion-notices) for how handlers emit these.
- **Performance.** frogConvert detects available RAM and adjusts limits to prevent crashes on lower-end devices.

## Known limitations

- **PDF input on Safari.** Safari's JavaScript engine cannot handle PDF input for conversions (PDF to PNG, PDF to TXT, etc.). Use Chrome or Firefox for PDF input. Other formats work normally on Safari.
- **Office documents (DOCX, PPTX, XLSX, ODT, ODP, ODS).** Converting to PDF via LibreOffice requires [LibreOffice](https://www.libreoffice.org/) installed locally. The UI surfaces an install prompt when needed.
- **Encrypted files** are not supported. Remove the password first.

## See also

- [PDF_EDITOR.md](PDF_EDITOR.md) - merge, reorder, extract PDF pages.
- [INTEGRATIONS.md](INTEGRATIONS.md) - MCP and REST API for scripting conversions.
- [../SECURITY.md](../SECURITY.md) - privacy posture and threat model.
