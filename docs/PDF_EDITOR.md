<!-- docs-frontmatter
icon: 📄
label: PDF Editor
desc: Merge, organize, extract, and watermark PDFs in your browser
-->

# PDF Editor

frogConvert ships with a built-in **PDF editor** alongside the file converter. Unlike the converter (which originates from the [Convert to it!](https://github.com/p2r3/convert) fork), the PDF editor is **frogConvert-original**; it was designed and built specifically for this project and is not present in the upstream repo.

It handles the operations most people reach for a paid tool to do: merging, reordering pages, extracting pages, and stamping a watermark. Everything runs locally in your browser; no files are uploaded anywhere.

## Switching to editor mode

The top bar's mode control opens a menu with **Converter**, **PDF Editor** and **Compress**. Pick **PDF Editor** to swap the workspace. Your app URL updates to `/pdf` so you can bookmark or share the editor directly.

Shrinking a PDF *without* editing it lives in the [Compress](COMPRESS.md) mode. The editor can also compress what it saves as an optional final step; see [Shrinking a saved PDF](#shrinking-a-saved-pdf) below.

## Managing the file list

Every tab's sidebar lists the loaded files, and carries the same three actions wherever it appears (desktop panel or the phone tray):

- **`+ Add`**, below the list, appends more files.
- **Replace all**, in the count row, swaps the whole list for a fresh pick. Cancelling the picker changes nothing.
- **Clear**, beside it, empties the editor and returns you to the drop zone. It asks first, because page order, rotations and watermark settings go with the files.

Individual files carry an `x` on their row. On Merge, selecting cards also grows a **Remove N files** button for the selection.

## What you can do

### Merge

Combine multiple PDFs into a single output.

1. Drop two or more PDFs onto the workspace (or click to browse).
2. The files appear in a reorderable list. Drag to change the merge order.
3. Click **Merge** to generate the combined PDF and download it.

### Organize (and Extract)

Reshape a single PDF at the page level. Extract is a sub-mode of the same tab, not a separate tab.

1. Drop one PDF onto the workspace.
2. Page thumbnails render in a grid.
3. Do any of the following:
   - **Reorder** - drag a page to a new position.
   - **Rotate** - click the rotate control on a page (±90°; rotations compose).
   - **Insert blank** - drop a blank page at any position.
   - **Delete** - remove unwanted pages.
   - **Extract** - select the page range you want and export it as a new standalone PDF.
4. Click **Save** (or **Export** for an extract) to generate the resulting PDF.

### Watermark

Stamp a text watermark across selected pages, drawn at the page center or tiled across the whole page.

1. Drop one or more PDFs onto the workspace and switch to the **Watermark** tab.
2. Choose **Pages** by typing a range like `1-3, 8, 10-12`. With multiple files the range is over the flattened page sequence (file A's pages first, then file B, etc.). **Select all** fills `1-N`; **Deselect all** clears.
3. Type the watermark text (default `CONFIDENTIAL`).
4. Adjust style: size, color, opacity, rotation. Toggle **Repeat across page** to tile the watermark across the page with internally-computed spacing.
5. The preview is the actual output for the page being viewed; it updates as you adjust settings.
6. Click **Export PDF**. With multiple files you'll be asked whether to produce one combined PDF or one watermarked PDF per source file (per-source delivers a zip).

Watermarks are visual marks. They do not encrypt the PDF, prevent copying, or interfere with editing, they exist to discourage casual misuse and to label drafts.

Caveats specific to watermark:

- **Helvetica only**, text watermarks use the standard PDF Helvetica font (WinAnsi). Characters outside that set (CJK, emoji, some accented Eastern European glyphs) are rejected at input time.
- **Page rotation inherits**, if a page was rotated via Organize, the watermark drawn into that page's content stream is rotated together with it.

## Keyboard shortcuts

Available in the Organize tab when a page is focused or selected:

| Shortcut | Action |
|----------|--------|
| `Click` | Toggle the page's selection. |
| `Shift + Click` | Range-select between the last clicked page and this one. |
| `Ctrl + Click` (Win) / `Cmd + Click` (Mac) | Toggle a single page without disturbing a Shift range. |
| `Space` / `Enter` | Toggle the focused page (matches `Click`). |
| `Arrow Up` / `Arrow Down` | Move the current selection up or down by one slot when at least one page is selected. |
| `Delete` / `Backspace` | Delete the selected pages. |
| `Escape` | Clear the current selection. |
| `Ctrl + Z` / `Cmd + Z` | Undo the last mutation (reorder, rotate, delete, blank insert). 30 levels deep. |
| `Ctrl + Y` / `Ctrl + Shift + Z` | Redo. |

The tab bar (`Merge` / `Organize` / `Watermark`) supports `Arrow Left` / `Arrow Right` / `Home` / `End` for keyboard navigation between tabs, and the format-picker modal supports `Arrow Up` / `Arrow Down` / `Home` / `End` for navigating the option list.

## Inputs and limits

- **Input**: one or more `.pdf` files.
- **Size**: limited only by your device memory. Large PDFs (hundreds of pages) render thumbnails lazily to stay responsive.
- **Output**: one or more `.pdf` files, saved via your browser's standard download flow. Merge, Organize, and Extract always produce a single PDF. Watermarking multiple files at once offers a choice: one combined PDF, or one watermarked PDF per source (delivered as a zip).

## Shrinking a saved PDF

The **PDF compression** control at the bottom of the settings menu (the control is titled for whichever mode you are in) defaults to **Original quality** - merging and watermarking are edits, not exports, so by default you get back exactly the document the editor built.

Set it to anything else and every save (merge, organize, watermark, extract) runs its finished PDF through Ghostscript on the way to the download, at the same levels and with the same 98% keep-threshold the [Compress](COMPRESS.md) surface uses. If the result wouldn't be meaningfully smaller, or the engine can't run at all, the step is skipped and you get the uncompressed PDF - a completed edit is never lost to an optional extra.

Note that this only resamples **images**. A PDF that is mostly text won't shrink much at any level; see [COMPRESS.md § PDF compression, honestly](COMPRESS.md#pdf-compression-honestly).

## Known caveats

- **Safari**: Safari's JS engine has trouble with `pdfjs-dist` rendering for PDF input. A fallback path is in place so the editor still works, but thumbnail generation may be slower than in Chrome or Firefox.
- **Forms and annotations**: not yet supported. Form-fill, digital signatures, and annotations are out of scope for the current editor; the focus is structural edits (merge, reorder, rotate, extract). Beyond "not supported", one behaviour is worth knowing before you merge something you care about: **merging a fillable PDF drops its form fields**. Measured on a 1-page AcroForm with three fields (`Name`, `Check`, `Submit`) merged with a 4-page document - the output has all 5 pages and the fields render as flat content, no longer fillable. Watermark and Organize keep them, because they write to the pages you already have rather than copying them into a new document. If you need the form to stay a form, watermark or reorder it, but merge it last (or not at all).
- **Encrypted PDFs**: password-protected PDFs are not supported. Merge, Organize, Watermark and Extract each decline one with a message naming the file; remove the password with another tool first. The refusal is explicit on purpose. Until v3.0.0 the editor loaded these files with encryption ignored, which suppresses the error without supplying a password, so the pages copied across structurally intact and completely blank - measured on a merge of a protected file with a 4-page document, the output had all 5 pages and page 1 carried zero characters, with nothing on screen to say so.

## Privacy

Same as the converter: nothing leaves your device. The PDF editor uses [pdf-lib](https://pdf-lib.js.org/) for writes and [pdfjs-dist](https://mozilla.github.io/pdf.js/) for rendering, both running entirely in-browser. No server round-trips. See [../SECURITY.md](../SECURITY.md).

## Programmatic access

Every PDF editor operation is also exposed via MCP and REST: `pdf_merge`, `pdf_organize`, `pdf_extract`, `pdf_watermark` (MCP tools) and `POST /pdf/{merge,organize,extract,watermark}` (REST). See [INTEGRATIONS.md § MCP Tools Reference](INTEGRATIONS.md#mcp-tools-reference) and [§ REST API Reference](INTEGRATIONS.md#rest-api-reference).

## See also

- [CONVERTER.md](CONVERTER.md) - file conversion (the other workspace).
- [INTEGRATIONS.md](INTEGRATIONS.md) - MCP and REST API.
- [ARCHITECTURE.md § PDF Workspace](ARCHITECTURE.md#pdf-workspace-editor-mode) - subsystem design for contributors.
- [../SECURITY.md](../SECURITY.md) - privacy posture and known limits.
