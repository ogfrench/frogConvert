<!-- docs-frontmatter
icon: 📄
label: PDF Editor
desc: Merge, organize, and extract PDFs in your browser
-->

# PDF Editor

frogConvert ships with a built-in **PDF editor** alongside the file converter. Unlike the converter (which originates from the [Convert to it!](https://github.com/p2r3/convert) fork), the PDF editor is **frogConvert-original**; it was designed and built specifically for this project and is not present in the upstream repo.

It handles the three operations most people reach for a paid tool to do: merging, reordering pages, and extracting pages. Everything runs locally in your browser; no files are uploaded anywhere.

## Switching to editor mode

The top bar has a **Converter / PDF Editor** pill toggle. Click **PDF Editor** to swap the workspace. Your app URL updates to `/pdf` so you can bookmark or share the editor directly.

## What you can do

### Merge

Combine multiple PDFs into a single output.

1. Drop two or more PDFs onto the workspace (or click to browse).
2. The files appear in a reorderable list. Drag to change the merge order.
3. Click **Merge** to generate the combined PDF and download it.

### Organize

Reshape a single PDF at the page level.

1. Drop one PDF onto the workspace.
2. Page thumbnails render in a grid.
3. Do any of the following:
   - **Reorder** - drag a page to a new position.
   - **Rotate** - click the rotate control on a page (±90°; rotations compose).
   - **Insert blank** - drop a blank page at any position.
   - **Delete** - remove unwanted pages.
4. Click **Save** to generate the reorganized PDF.

### Extract

Pull a page range out of a PDF as a new standalone file. Available from the Organize view: select the page range you want and export.

## Inputs and limits

- **Input**: one or more `.pdf` files.
- **Size**: limited only by your device memory. Large PDFs (hundreds of pages) render thumbnails lazily to stay responsive.
- **Output**: a single `.pdf`, saved via your browser's standard download flow.

## Known caveats

- **Safari**: Safari's JS engine has trouble with `pdfjs-dist` rendering for PDF input. A fallback path is in place so the editor still works, but thumbnail generation may be slower than in Chrome or Firefox.
- **Forms and annotations**: not yet supported. Form-fill, digital signatures, and annotations are out of scope for the current editor; the focus is structural edits (merge, reorder, rotate, extract).
- **Encrypted PDFs**: password-protected PDFs are not supported. Remove the password first using another tool.

## Privacy

Same guarantee as the converter: nothing leaves your device. The PDF editor uses [pdf-lib](https://pdf-lib.js.org/) for writes and [pdfjs-dist](https://mozilla.github.io/pdf.js/) for rendering, both running entirely in-browser. No server round-trips. See [../SECURITY.md](../SECURITY.md) for the full privacy statement.

## Programmatic access

Every PDF editor operation is also exposed via MCP and REST: `pdf_merge`, `pdf_organize`, `pdf_extract` (MCP tools) and `POST /pdf/{merge,organize,extract}` (REST). See [INTEGRATIONS.md § MCP Tools Reference](INTEGRATIONS.md#mcp-tools-reference) and [§ REST API Reference](INTEGRATIONS.md#rest-api-reference).

## See also

- [CONVERTER.md](CONVERTER.md) - file conversion (the other workspace).
- [INTEGRATIONS.md](INTEGRATIONS.md) - MCP and REST API.
- [ARCHITECTURE.md § PDF Workspace](ARCHITECTURE.md#pdf-workspace-editor-mode) - subsystem design for contributors.
- [../SECURITY.md](../SECURITY.md) - privacy posture and known limits.
