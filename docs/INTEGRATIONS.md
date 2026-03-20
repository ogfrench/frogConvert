---
icon: 🤖
label: Integrations
desc: MCP & REST API Guide
---

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
| **Large files** | Use `filePath`-based multipart | Use `filePath` + `outputFilePath` params |

**TL;DR: Use the REST API unless you specifically need Claude to drive conversions autonomously without shell access.**

---

## Quick Start - No Repo Clone Required

The easiest way to use frogConvert as an MCP server or REST API is directly via `bunx` - no clone or install needed. Requires [Bun](https://bun.sh/).

### MCP Server (for Claude Code / Claude Desktop)

Add this to your MCP config (`~/.claude.json` or `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "frogconvert": {
      "command": "bunx",
      "args": ["frogconvert", "mcp"]
    }
  }
}
```

### REST API Server

```bash
bunx frogconvert api
# Optional: PORT=8080 bunx frogconvert api
```

> **Privacy:** All file processing is 100% local. No files are ever sent to any remote server.

> **Prerequisites:** For audio/video formats, native `ffmpeg` gives best results (`winget install ffmpeg` / `brew install ffmpeg`). frogConvert falls back to a bundled static binary and then WASM automatically.

---

## MCP Tools Reference

Three tools, all over `stdio`:

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
   - **Large file guidance**: For files that are too large to embed in the context window, always use `filePath` (input) and `outputFilePath` (output) together:
     ```
     filePath: "/absolute/path/to/input.png"
     outputFilePath: "/absolute/path/to/output.pptx"
     ```

---

## REST API Reference

A local HTTP REST API is also available as an alternative to MCP - useful for shell scripts, curl, or any HTTP client. Binds to `http://127.0.0.1:3000`; override with the `PORT` env var.

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
  -o output.png
```
- Input MIME/extension are auto-detected from the uploaded filename.
- Response: raw binary of the first output file with `Content-Disposition: attachment; filename*=UTF-8''...` header. If conversion produces multiple files, the remaining filenames are listed in an `X-Extra-Files` JSON header - use the JSON API instead if you need all files.

**Option B - application/json**:
```bash
curl -X POST http://127.0.0.1:3000/convert \
  -H 'Content-Type: application/json' \
  -d '{"fileName":"input.jpg","base64Bytes":"...","inputMime":"image/jpeg","inputExt":"jpg","outputMime":"image/png","outputExt":"png"}'
```
- Response: `[{ "fileName": "output.png", "base64Bytes": "<base64>" }]` (array supports multi-file outputs)

Returns `400` on bad input, `415` if Content-Type is unsupported, `422` if no path found or conversion fails.

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

---

For internal architecture details, handler rules, and the full file structure, see **[ARCHITECTURE.md](ARCHITECTURE.md)** and **[CONTRIBUTING.md](CONTRIBUTING.md)**.
