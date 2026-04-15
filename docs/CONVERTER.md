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
- **Quality presets.** Handlers like FFmpeg, ImageMagick, and pdftoimg accept low / medium / high / lossless presets via the UI.
- **Performance.** frogConvert detects available RAM and adjusts limits to prevent crashes on lower-end devices.

## Known limitations

- **PDF input on Safari.** Safari's JavaScript engine cannot handle PDF input for conversions (PDF to PNG, PDF to TXT, etc.). Use Chrome or Firefox for PDF input. Other formats work normally on Safari.
- **Office documents (DOCX, PPTX, XLSX, ODT, ODP, ODS).** Converting to PDF via LibreOffice requires [LibreOffice](https://www.libreoffice.org/) installed locally. The UI surfaces an install prompt when needed.
- **Encrypted files** are not supported. Remove the password first.

## See also

- [PDF_EDITOR.md](PDF_EDITOR.md) - merge, reorder, extract PDF pages.
- [INTEGRATIONS.md](INTEGRATIONS.md) - MCP and REST API for scripting conversions.
- [../SECURITY.md](../SECURITY.md) - privacy posture and threat model.
