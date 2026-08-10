<!-- docs-frontmatter
icon: 🤖
label: Integrations
desc: MCP & REST API Guide
-->

# Integrations - MCP & REST API Guide

frogConvert is a universal file converter that provides programmatic access via a built-in MCP server and local REST API. This guide covers how to connect AI agents or scripts to the conversion engine.

When working with frogConvert programmatically, **use the REST API or MCP server rather than the web UI**. The tools below cover everything you'd do through the browser.

> **REST API is recommended for most programmatic use cases.** It requires no approval prompts, works with any HTTP client (`curl`, `fetch`, shell scripts), and is faster to iterate with. The MCP server is best suited for fully autonomous Claude-driven workflows (Claude Code / Claude Desktop) where you want Claude to call conversions without any shell access - but note that each MCP tool call triggers a permission prompt unless pre-approved in settings.

---

## REST API vs MCP - Which Should You Use?

| | REST API | MCP Server |
|---|---|---|
| **Recommended for** | Scripts, curl, CI, any HTTP client | Claude Code / Claude Desktop autonomous workflows |
| **Permission prompts** | None | Required per tool call (unless pre-approved in settings) |
| **Iteration speed** | Fast | Slower due to approval gate |
| **Interface** | HTTP (`curl`, `fetch`, any language) | `stdio` JSON-RPC |
| **Setup** | `bunx frogconvert api` | Add to MCP config, restart Claude |
| **Large files** | Use multipart form-data (`file` field) | Use `filePath` + `outputFilePath` params |

**TL;DR: Use the REST API unless you specifically need Claude to drive conversions autonomously without shell access.**

---

## Running the servers

For installation and CLI usage, see [DEPLOYMENT.md § CLI](DEPLOYMENT.md#cli-no-repo-clone-required). For privacy posture, see [../SECURITY.md](../SECURITY.md).

> **Prerequisites:** for audio/video formats, native `ffmpeg` gives best results (`winget install ffmpeg` / `brew install ffmpeg`). frogConvert falls back to a bundled static binary and then WASM automatically.

---

## MCP Tools Reference

Eight tools, all over `stdio`: one metadata (`list_formats`), two conversion (`find_conversion_path`, `convert_file`), one compression (`compress_file`), four PDF editing (`pdf_merge`, `pdf_organize`, `pdf_extract`, `pdf_watermark`).

1. **`list_formats`**
   - **Description**: Returns a JSON array of all supported input and output formats available in the Node.js environment.
   - **Usage**: Use this to see what extensions and MIME types are currently supported.

2. **`find_conversion_path`**
   - **Arguments**: `inputMime`, `inputExtension`, `outputMime`, `outputExtension`
   - **Description**: Uses frogConvert's `TraversionGraph` algorithm to calculate the step-by-step handler chain required to convert from the input to the output.
   - **Returns**: A text string of the form `Path: HandlerA (mime/type) -> HandlerB (mime/type)`. Returns an error if no native or browser path exists. If no native path exists but the browser bridge can handle it, returns an informational note instead of an error.

3. **`convert_file`**
   - **Arguments**:
     | Argument | Required | Description |
     |---|---|---|
     | `filePath` | one of `filePath`/`base64Bytes` | Absolute path to a local file. The server reads it directly - use this for large files to avoid context window limits. |
     | `base64Bytes` | one of `filePath`/`base64Bytes` | Base64-encoded file content. |
     | `fileName` | required with `base64Bytes`; optional with `filePath` | Input filename (e.g. `image.jpg`). Inferred from `filePath` basename when omitted. |
     | `inputMime` | required | Input MIME type. |
     | `inputExtension` | required | Input format extension. |
     | `outputMime` | required | Output MIME type. |
     | `outputExtension` | required | Output format extension. |
     | `outputFilePath` | optional | Absolute path where the output file should be saved. **Strongly recommended for large outputs** - avoids returning megabytes of base64 through the context window. |
     | `quality` | optional | Quality preset: `"low"`, `"medium"`, `"high"`, or `"lossless"`. Applies to the re-encode a *cross-format* conversion performs; when omitted it is `"lossless"`. To make a file smaller without changing its format, use [`compress_file` / `POST /compress`](#compression) instead. See [Quality preset](#quality-preset). |
   - **Description**: The core execution tool. Routes the file through the handler chain and returns all output files.
   - **Returns**:
     - When `outputFilePath` is omitted - a JSON array of output files:
       ```json
       [{ "fileName": "output.png", "base64Bytes": "<base64>" }]
       ```
     - When `outputFilePath` is provided - a JSON object with the saved paths:
       ```json
       { "savedTo": ["/path/to/output.pptx"] }
       ```
     The array contains multiple entries when a conversion produces multiple output files (e.g. a multi-page PDF split into individual images).
     Both response shapes may include an optional `warnings` array of strings when the conversion adapted silently (dimension padding, sample-rate snap, large-PDF shrink, long video-to-GIF trim, adaptive frame sampling). Example: `{ "savedTo": [...], "warnings": ["Trimmed to the first 60 seconds. GIF gets unwieldy past a minute of video..."] }`.
   - **LibreOffice hint**: If conversion fails for office formats (DOCX, PPTX, XLSX, ODT, etc.) and LibreOffice is not installed, the error message includes a hint to install it from [libreoffice.org](https://www.libreoffice.org/).
   - **Large file guidance**: For files that are too large to embed in the context window, always use `filePath` (input) and `outputFilePath` (output) together:
     ```
     filePath: "/absolute/path/to/input.png"
     outputFilePath: "/absolute/path/to/output.pptx"
     ```

### PDF editor tools

The PDF editor is exposed as three dedicated MCP tools. They operate on PDFs directly using `pdf-lib`; they do not run the browser bridge.

4. **`pdf_merge`**
   - **Arguments**:
     | Argument | Required | Description |
     |---|---|---|
     | `inputs` | required, min 2 | Array of `{ filePath?, base64Bytes?, fileName? }`. Each entry must supply either `filePath` or `base64Bytes`. |
     | `outputFilePath` | optional | Absolute path to save the merged PDF. If omitted, returns base64. |
   - **Description**: Concatenates pages from the input PDFs in the order given.
   - **Returns**: same shape as `convert_file` (array of `{ fileName, base64Bytes }`, or `{ savedTo: [...] }` when `outputFilePath` is set).

5. **`pdf_organize`**
   - **Arguments**:
     | Argument | Required | Description |
     |---|---|---|
     | `inputs` | required, min 1 | Source PDFs (same shape as `pdf_merge.inputs`). |
     | `pages` | required, min 1 | Ordered page manifest (see below). |
     | `outputFilePath` | optional | Save target; otherwise base64 is returned. |
   - **Page manifest entry**:
     ```
     {
       "sourceIndex": number,   // index into inputs[], or -1 for a blank page
       "pageNum":     number,   // 1-indexed page in source PDF, 0 for blank
       "rotation":    0 | 90 | 180 | 270,   // optional, default 0
       "blank":       boolean,              // optional; if true, inserts a blank
       "blankSize":   { "width": number, "height": number }  // optional blank size
     }
     ```
   - **Description**: Builds a new PDF by reordering, rotating, deleting, and inserting blank pages from one or more source PDFs. Delete is implicit: omit a page from the manifest.
   - **Returns**: same shape as `pdf_merge`.

6. **`pdf_extract`**
   - **Arguments**:
     | Argument | Required | Description |
     |---|---|---|
     | `input` | required | Single source PDF (`{ filePath?, base64Bytes?, fileName? }`). |
     | `pageNums` | required, min 1 | Array of 1-indexed page numbers to extract. |
     | `baseName` | optional | Base name for outputs. Defaults to the input filename stem. |
     | `groupAsOne` | optional, default `false` | `true` returns one combined PDF; `false` returns one PDF per page. |
     | `outputDir` | optional | Absolute directory to save outputs; otherwise base64 is returned. |
   - **Description**: Extracts the given pages from a source PDF.
   - **Returns**: array of `{ fileName, base64Bytes }` (one per output file), or `{ savedTo: [...] }` listing written paths when `outputDir` is set.

7. **`pdf_watermark`**
   - **Arguments**:
     | Argument | Required | Description |
     |---|---|---|
     | `input` | required | Single source PDF (`{ filePath?, base64Bytes?, fileName? }`). |
     | `text` | required | Watermark text (e.g. `"CONFIDENTIAL"`). |
     | `fontSize` | optional, default `80` | Font size in points. |
     | `colorHex` | optional, default `"#808080"` | Color as `#RRGGBB` hex. |
     | `opacity` | optional, default `0.5` | Watermark opacity in `[0, 1]`. |
     | `rotationDegrees` | optional, default `-45` | Rotation in degrees. |
     | `repeat` | optional, default `false` | When `true`, tile the watermark across each target page with internally-computed spacing. |
     | `pageNums` | optional | 1-indexed page numbers to watermark. Omit for all pages. |
     | `outputFilePath` | optional | Absolute path to save the output; otherwise base64 is returned. |

     Uses the standard PDF Helvetica (WinAnsi). Characters outside WinAnsi are rejected at input time. Watermarks are drawn at page center; placement preset selection is not exposed.
   - **Description**: Apply a text watermark to selected pages of a PDF. Watermarks are visual marks; they do not encrypt or restrict copying.
   - **Returns**: same shape as `pdf_merge`, `[{ fileName, base64Bytes }]`, or `{ savedTo: ["..."] }` when `outputFilePath` is set.

---

## REST API Reference

A local HTTP REST API is also available as an alternative to MCP - useful for shell scripts, curl, or any HTTP client. Binds to `http://127.0.0.1:3000` (loopback only) and rejects requests whose `Origin` or `Host` headers are not `localhost`, `127.0.0.1`, or `[::1]` (DNS-rebinding defense). Override the port with the `PORT` env var. See [../SECURITY.md](../SECURITY.md) for the full privacy posture.

### Endpoints

#### `GET /health`
Returns server status and loaded handler names.
```json
{ "status": "ok", "handlers": ["FFmpeg", "ImageMagick", ...] }
```

#### `GET /formats`
Returns all supported formats (same data as `list_formats` MCP tool).
```json
[{ "name": "...", "mime": "...", "extension": "...", "handler": "...", "canRead": true, "canWrite": false }]
```

#### `GET /path?inputMime=&inputExt=&outputMime=&outputExt=`
Finds the conversion path between two formats.
```json
{ "path": [{ "handler": "FFmpeg", "mime": "image/jpeg", "extension": "jpeg", "format": "jpeg" }, ...] }
```
Returns `404` with `{ "error": "..." }` if no path exists.

#### `POST /convert`

**Option A - multipart/form-data** (easiest for curl):
```bash
curl -X POST http://127.0.0.1:3000/convert \
  -F 'file=@input.jpg' \
  -F 'outputMime=image/png' \
  -F 'outputExt=png' \
  -F 'quality=high' \
  -o output.png
```
- Input MIME/extension are auto-detected from the uploaded filename.
- `quality` is optional (`"low"`, `"medium"`, `"high"`, `"lossless"`). See [Quality preset](#quality-preset) for what happens when it is omitted.
- Response: raw binary of the first output file with `Content-Disposition: attachment; filename*=UTF-8''...` header. If conversion produces multiple files, the remaining filenames are listed in an `X-Extra-Files` JSON header - use the JSON API instead if you need all files.

**Option B - application/json**:
```bash
curl -X POST http://127.0.0.1:3000/convert \
  -H 'Content-Type: application/json' \
  -d '{"fileName":"input.jpg","base64Bytes":"...","inputMime":"image/jpeg","inputExt":"jpg","outputMime":"image/png","outputExt":"png","quality":"high"}'
```
- Response: `[{ "fileName": "output.png", "base64Bytes": "<base64>" }]` (array supports multi-file outputs)
- `quality` field is optional. See [Quality preset](#quality-preset) for the omitted-value behaviour.

Returns `400` on bad input, `413` if the file exceeds `MAX_UPLOAD_MB`, `415` if Content-Type is unsupported, `422` if no path found or conversion fails.

#### Quality preset

Both `POST /convert` and the MCP `convert_file` tool accept an optional `quality` preset, which governs the re-encode a conversion performs. **When omitted it is `"lossless"`**: a conversion changes the format and nothing else. Pass a level explicitly to also shrink the file, or use [`compress_file` / `POST /compress`](#compression) to shrink one without changing its format.

The preset is a request-level parameter here. The web UI's equivalent settings - **Compression** in the Converter's settings menu and the level picker on the **Compress** surface - are per-surface browser preferences stored in `localStorage`; they do not reach the API or MCP server, which run in a separate process. Pass `quality` explicitly to get a specific tier.

| Preset | JPEG singleton | Image resize cap | PDF page render cap | Video-frame cap | Video-to-GIF cap | Audio (stereo lossy) | Auto-adaptation |
|---|---|---|---|---|---|---|---|
| `low` | q65 | 1920 px | 1.2 MP | ~120 frames | 30s | 128 kbps | Fires earliest |
| `medium` | q80 | 2560 px | 2.5 MP | ~300 frames, 1920 px | 60s | 192 kbps | Fires at the midpoint |
| `high` | q93 | no cap | 5.0 MP | ~1000 frames, 3840 px | 180s | 256 kbps | Fires latest |
| `lossless` | q100 | no cap | 25 MP | no cap | no cap | uncompressed | Disabled |

> **Changed in v3.0.0.** `low` and `medium` were q82 and q90 with no resize cap -
> an 11-point band that put all three presets inside what other tools call high
> quality. `low` is now q65 and `medium` q80, and both **downscale**: a
> 4032x3024 phone photo comes back 1920x1440 at `low`. If your script depended
> on a `quality: "low"` conversion preserving pixel dimensions, pass `high` or
> `lossless` instead. `high` and `lossless` are unchanged.
>
> **The omitted-`quality` default also changed, from `medium` to `lossless`.**
> A request that says nothing about quality now returns the conversion at full
> fidelity rather than q80 with a 2560 px cap. This matches the web UI, whose
> Converter defaults to Original quality for the same reason: an agent cannot
> see the output, the caller may never learn the image was resized, and the
> conversion is usually the only copy kept. Scripts that relied on the old
> behaviour should pass `quality: "medium"` explicitly.

Adaptive-cap behavior (frame sampling, GIF trim, PDF auto-shrink) applies at all lossy presets. `lossless` disables all of them, so it can produce very large outputs.

Handlers ignore the preset when it doesn't apply to them (lossless codecs, structural conversions like DOCX→PDF, etc.).

A conversion that *produces* a PDF (`PDF → PDF/A`, `PS → PDF`) passes the preset to Ghostscript's distiller: `low` → `/screen`, `medium` → `/ebook`, `high` → `/printer`, `lossless` → `/prepress`.

#### Quality across multi-step routes

A conversion may take more than one hop (e.g. HEIC → PNG → WebP). Quality is
reduced **once**, on the final hop that produces the file you receive;
intermediate hops run at the gentlest practical setting. Re-applying the target
preset at every step would compound generation loss, and quality discarded on an
early hop cannot be recovered by a gentler later one.

`quality: "lossless"` is honoured on every hop, so "no compression" means it end
to end. A hop whose output format is inherently lossless (PNG, FLAC…) always
runs lossless, since a quality knob can't shrink it.

This rule is shared by every surface - web UI, REST, MCP and CLI - so the same
file and the same `quality` produce the same result whichever way you convert.

### Compression

Compression has its own endpoint and its own tool: **`POST /compress`** and **`compress_file`**. Use those, not `convert_file` with the same format twice.

> **Changed in v3.0.0.** Earlier documentation described same-format `convert` as the way to compress. It did not work: a same-format request resolves to a zero-hop path through the conversion graph and the runner executes no steps, so the input came straight back. Measured, a 10 MB image-heavy PDF returned byte-identical at every preset while the browser shrank the same file by 89%. Same-format `convert` still returns your file unchanged; it is simply not a compressor, and nothing about the fix changed cross-format conversion.

Both surfaces share the engine selection, the level vocabulary and the 98% keep-threshold with the browser's Compress surface, so a rule added in one place reaches all three.

**What actually compresses here.** These surfaces run in Node, and not every engine does:

| Input | REST / MCP | Browser |
|---|---|---|
| Images (JPEG, PNG, WebP…) | yes, ImageMagick | yes |
| PDF | yes, Ghostscript | yes |
| Video and audio | **no** - reported `unsupported` | yes, FFmpeg |

`ffmpeg.wasm` does not run under Node, so the handler never initialises in-process. `convert_file`, `POST /convert`, `compress_file` and `POST /compress` all fall back to the same headless-browser bridge, so video and audio compress over the API exactly as they do in the web UI. The first such call pays for starting the browser; afterwards it is warm. If the bridge cannot be reached, the file comes back with `shrunk: false`, `reason: "unsupported"` and its **original bytes** - never an empty file.

**Levels:** `auto` (default), `high`, `medium`, `low`. `auto` probes each file and picks a level for it, exactly as the web UI does. There is deliberately **no `lossless`**: as a compression level it can only mean "do nothing", and the endpoint rejects it rather than silently substituting something else.

**The keep-threshold is real here.** If a re-encode saves less than 2%, the original bytes are returned and the report says `shrunk: false` with a reason. You never pay for a re-encode with a larger file.

#### `POST /compress`

Multipart returns the bytes as a download with the report in an `X-Compress-Report` header:

```bash
curl -X POST http://localhost:3000/compress \
  -F "file=@scan.pdf" -F "level=low" \
  -D headers.txt -o scan-small.pdf
```

JSON returns the report with the bytes inline, and accepts a batch:

```bash
curl -X POST http://localhost:3000/compress \
  -H "Content-Type: application/json" \
  -d '{"level":"low","files":[{"fileName":"a.pdf","base64Bytes":"..."}]}'
```

```json
{
  "level": "low",
  "files": [
    { "name": "a.pdf", "originalSize": 10141096, "compressedSize": 128053,
      "savedBytes": 10013043, "savedPercent": 98.7, "shrunk": true,
      "base64Bytes": "..." }
  ]
}
```

#### `compress_file` (MCP)

| Field | Required | Notes |
|---|---|---|
| `filePath` | one of | Absolute path. Preferred for large files - base64 in a tool result eats context. |
| `base64Bytes` + `fileName` | one of | The in-band alternative. The extension identifies the format. |
| `filePaths` | optional | A batch, compressed in one pass. Each result is written beside its source as `name-compressed.ext`, never over it. |
| `outputFilePath` | optional | Where to write a single result. Omit to get base64 back. |
| `level` | optional | `auto` (default), `high`, `medium`, `low`. |

A file that could not be shrunk comes back with `shrunk: false` and a `reason`, not an error - one unsupported file in a batch never costs you the rest.

#### PDF compression

A PDF sent to `POST /compress` or `compress_file` is compressed through Ghostscript, the same engine the web UI's Compress surface uses. The `level` maps onto Ghostscript's distiller presets:

| `level` | `-dPDFSETTINGS` | Image target |
|---|---|---|
| `low` | `/screen` | 72 dpi |
| `medium` | `/ebook` | 150 dpi |
| `high` | `/printer` | 300 dpi |
| `auto` | picked per file | probes the PDF and chooses |

There is no `lossless` here - see the levels note above. `/prepress` is reachable only through a *conversion* that produces a PDF, where the parameter is `quality`.

Four things to expect, so a correct result isn't mistaken for a broken one:

- **A password-protected PDF is declined, not compressed.** Ghostscript has no password, so it reads the page tree, fails to decrypt the content streams, and writes that many *empty* pages - with the page count preserved exactly, which is why a page-count check cannot catch it. Measured before this was guarded: 12,783 bytes and a page of text became 2,188 bytes of blank page, reported as an 83% saving. You now get `shrunk: false` and your original bytes back, still encrypted. This matters more for an agent than for a person: a script compressing a folder has nothing on screen to notice the difference.

- **A text or vector PDF barely shrinks, and that is right.** Ghostscript's presets bound *image* resampling; text and vector art are left alone because there is nothing to throw away. Scans and image-heavy decks are where the 30–80% savings live. If the result saves less than 2%, the size-guard returns the original.
- **The first PDF in a process is slower.** The 16 MB WASM engine is compiled on first use and then reused, so subsequent files in the same process are markedly faster (measured: 718 ms then 248 ms). It is never loaded at startup - a session that touches no PDFs never pays for it.
- **A lower level can produce a *larger* PDF.** Ghostscript's presets are not monotonic in output size: on one 71-page research brief `/screen` grew the file 42% and `/ebook` 65%, while `/printer` shrank it 18%. The keep-threshold means you never receive the larger file - you get the original with `shrunk: false` - but it does mean `low` is not reliably the smallest answer for PDFs. `auto` exists to pick per file rather than guess.

#### Compressing an edited PDF

The browser's PDF editor has a **PDF compression** setting that shrinks whatever it saves. The PDF tools below deliberately do not take a `quality` parameter - on the agent surfaces the same result is composition, not a flag: chain the edit into `compress_file` / `POST /compress`.

```
pdf_merge(inputs) -> compress_file(filePath: <merged>, level: "auto")
```

The second step is the identical Ghostscript pass the browser runs, keep-threshold included, so a merge whose compression would not pay for itself comes back at its edited size rather than degraded.

Do **not** chain into `convert_file(pdf -> pdf)` - that is the same-format no-op described above and returns the merged file untouched.

### PDF editor endpoints

Four REST routes mirror the MCP PDF tools. Input schemas are identical. Output shapes differ in one field name: MCP returns `{ fileName, base64Bytes }` (matching `convert_file`), REST returns `{ files: [{ name, base64Bytes }] }` (matching `POST /convert` JSON responses). Both include `{ savedTo: [...] }` when an output path is supplied.

#### `POST /pdf/merge`
JSON body:
```json
{
  "inputs": [{ "filePath": "/abs/a.pdf" }, { "filePath": "/abs/b.pdf" }],
  "outputFilePath": "/abs/merged.pdf"
}
```
- Each `inputs[]` entry takes `filePath` or `base64Bytes`, optionally `fileName`. Minimum 2 inputs.
- If `outputFilePath` is omitted, responds with `{ "files": [{ "name": "merged.pdf", "base64Bytes": "..." }] }`.
- If provided, responds with `{ "savedTo": ["/abs/merged.pdf"] }`.
- Returns `400` on bad input.

#### `POST /pdf/organize`
JSON body:
```json
{
  "inputs": [{ "filePath": "/abs/src.pdf" }],
  "pages": [
    { "sourceIndex": 0, "pageNum": 3, "rotation": 90 },
    { "sourceIndex": -1, "pageNum": 0, "blank": true, "blankSize": { "width": 612, "height": 792 } },
    { "sourceIndex": 0, "pageNum": 1 }
  ],
  "outputFilePath": "/abs/reshaped.pdf"
}
```
- `inputs[]` minimum 1. `pages[]` minimum 1; same manifest shape as the MCP tool.
- Response shape matches `POST /pdf/merge`.

#### `POST /pdf/extract`
JSON body:
```json
{
  "input": { "filePath": "/abs/doc.pdf" },
  "pageNums": [1, 3, 5],
  "baseName": "doc",
  "groupAsOne": false,
  "outputDir": "/abs/out"
}
```
- `pageNums` 1-indexed, minimum 1. `groupAsOne: true` combines all pages into a single PDF.
- If `outputDir` is set, response is `{ "savedTo": ["/abs/out/doc_page_1.pdf", ...] }`.
- Otherwise response is `{ "files": [{ "name": "...", "base64Bytes": "..." }, ...] }`.

#### `POST /pdf/watermark`
JSON body:
```json
{
  "input": { "filePath": "/abs/doc.pdf" },
  "text": "CONFIDENTIAL",
  "fontSize": 80,
  "colorHex": "#808080",
  "opacity": 0.5,
  "rotationDegrees": -45,
  "repeat": false,
  "pageNums": [1, 2, 3],
  "outputFilePath": "/abs/out.pdf"
}
```
- `text` required; `fontSize`, `colorHex`, `opacity`, `rotationDegrees`, `repeat` are optional with defaults `80`, `#808080`, `0.5`, `-45`, `false`.
- `pageNums` is optional; omit to watermark every page.
- `repeat: true` tiles the watermark across each target page.
- Validation errors (out-of-range page, malformed `colorHex`, opacity outside `[0, 1]`, non-boolean `repeat`) return `400`.
- Response shape matches `POST /pdf/merge`, `{ "files": [...] }` or `{ "savedTo": [...] }`.

---

## Browser-Assisted Conversions - Automatic Fallback

Conversions that require browser-only APIs (`Canvas`, `WebGL`, `AudioContext`, `document`) are handled automatically via a **Puppeteer browser bridge**. The server tries its native Node.js handler chain first; if no path is found, it transparently falls back to launching headless Chromium and running the conversion there using the full handler set.

This means conversions like PDF → PNG (via Canvas), SVG tracing, Three.js rendering, audio synthesis, and many others work out of the box - no special handling needed from the caller.

### Requirements for the browser bridge

- A production build must be present: run `bun run build` from the repo root before starting the MCP/API server.
- Puppeteer (already a dev dependency) must be accessible - it is when running from a repo clone.
- The `bunx frogconvert` quick-start **does not** include the browser bridge (no `dist/` is present without a clone and build step).

### Performance expectations

The browser bridge uses a **lazy-init architecture** - the headless page signals ready as soon as it has built the format graph from `cache.json` (a few seconds), then initialises individual WASM handlers on demand as conversions arrive.

| Call | Expected time |
|------|--------------|
| First ever call (cold Chromium) | 30 s – 8 min depending on handler |
| Second call, same handler | 2–10 s (Chromium warm, handler compiled) |
| Subsequent calls | Near-instant (handler already in memory) |

The first call is slow because headless Chromium must launch and the specific handler's WASM must be compiled in that browser context. Handlers that require heavy WASM (pandoc ~55 MB, ImageMagick ~80 MB) will be at the upper end. This is inherent to the cold-start path - subsequent calls are fast.

> **Tip:** If you need predictable latency, call `POST /convert` with a small browser-bridge conversion (e.g. a 1×1 PNG→SVG via svgTrace) immediately after starting the server to get Chromium running before real traffic arrives.

### How to detect browser-assisted paths

- `find_conversion_path` / `GET /path`: if no native path exists but the browser bridge can handle it, the response will indicate a browser-assisted path is available rather than returning an error.
  - MCP: returns text `"No native path found. A browser-assisted path is available - use convert_file to convert via the browser bridge."`
  - REST: returns `{ "browserAssisted": true, "message": "..." }` (HTTP 200)
- `convert_file` / `POST /convert`: the fallback is automatic - if the native path fails, the browser bridge is tried silently. The caller gets back the converted file(s) just like a native conversion.

### General fallback strategy for agents

| Situation | Action |
|-----------|--------|
| `GET /path` returns `browserAssisted: true` | Browser bridge will handle it - call `POST /convert` normally |
| `GET /path` returns 404 | No path available at all (neither native nor browser) |
| `POST /convert` returns 422 | No path found even via browser bridge |
| Format needs native binaries not in PATH | Check `/health` handler list; install missing tool |
| FFmpeg not found | `winget install ffmpeg` / `brew install ffmpeg` - bundled fallback activates automatically |
| Browser bridge fails to start | Ensure `bun run build` has been run and `dist/` exists |

> **Note to AI Agents:** If all programmatic conversion attempts fail, you can advise your human user to try the manual web UI at [frogconvert.xyz](https://frogconvert.xyz) as a final fallback.


---

## See also

- [DEPLOYMENT.md](DEPLOYMENT.md) - running the MCP server or REST API, environment variables, Docker, desktop builds.
- [PDF_EDITOR.md](PDF_EDITOR.md) - end-user PDF editor docs.
- [ARCHITECTURE.md](ARCHITECTURE.md) - internal subsystem design.
- [HANDLERS.md](HANDLERS.md) - authoring a new format handler.
