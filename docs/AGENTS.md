# AGENTS.md — AI Agent Guide for frogConvert

frogConvert is a universal file converter built on top of **[Convert to it!](https://p2r3.github.io/convert/)** by PortalRunner ([repo](https://github.com/p2r3/convert)). The core conversion engine — the `FormatHandler` interface, graph-based routing, and underlying handlers — is inherited from that project. frogConvert adds a redesigned UI and a built-in MCP server that gives AI agents direct programmatic access to the same engine.

When working with frogConvert programmatically, **use the MCP server or REST API rather than the web UI**. The tools below cover everything you'd do through the browser.

---

## ⚡ Quick Start — No Repo Clone Required

The easiest way to use frogConvert as an MCP server or REST API is directly via `bunx` — no clone or install needed. Requires [Bun](https://bun.sh/).

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

> **Prerequisites:** For audio/video formats, native `ffmpeg` gives best results (`winget install ffmpeg` / `brew install ffmpeg`). frogConvert falls back to a bundled static binary and then WASM automatically — see [README.md](../README.md#prerequisites) for the full fallback table.

---

## 🚀 MCP Tools Reference

Three tools, all over `stdio`:

1. **`list_formats`**
   - **Description**: Returns a JSON mapping of all supported input and output formats available in the Node.js environment.
   - **Usage**: Use this to see what extensions and MIME types are currently supported.

2. **`find_conversion_path`**
   - **Arguments**: `inputMime`, `inputExtension`, `outputMime`, `outputExtension`
   - **Description**: Uses frogConvert's `TraversionGraph` algorithm to calculate the step-by-step handler chain required to convert from the input to the output.
   - **Returns**: A visual string representation of the path (e.g. `ImageMagick (image/jpeg) -> ImageMagick (image/png)`). Returns an error if no path exists.

3. **`convert_file`**
   - **Arguments**: `fileName`, `base64Bytes`, `inputMime`, `inputExtension`, `outputMime`, `outputExtension`
   - **Description**: The core execution tool. Accepts a Base64 encoded file buffer, routes it through the handler chain, and returns all output files.
   - **Returns**: A JSON string (inside a `text` content block) that parses to an array of output files:
     ```json
     [{ "fileName": "output.png", "base64Bytes": "<base64>" }]
     ```
     The array contains multiple entries when a conversion produces multiple output files (e.g. a multi-page PDF split into individual images).

---

## 🌐 REST API Reference

A local HTTP REST API is also available as an alternative to MCP — useful for shell scripts, curl, or any HTTP client. Binds to `http://127.0.0.1:3000`; override with the `PORT` env var.

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

**Option A — multipart/form-data** (easiest for curl):
```bash
curl -X POST http://127.0.0.1:3000/convert \
  -F 'file=@input.jpg' \
  -F 'outputMime=image/png' \
  -F 'outputExt=png' \
  -o output.png
```
- Input MIME/extension are auto-detected from the uploaded filename.
- Response: raw binary with `Content-Disposition: attachment; filename="..."` header.

**Option B — application/json**:
```bash
curl -X POST http://127.0.0.1:3000/convert \
  -H 'Content-Type: application/json' \
  -d '{"fileName":"input.jpg","base64Bytes":"...","inputMime":"image/jpeg","inputExt":"jpg","outputMime":"image/png","outputExt":"png"}'
```
- Response: `[{ "fileName": "output.png", "base64Bytes": "<base64>" }]` (array supports multi-file outputs)

Returns `400` on bad input, `422` if no path found, `500` on conversion failure.

---

## 🌐 Browser-Assisted Conversions — Automatic Fallback

Conversions that require browser-only APIs (`Canvas`, `WebGL`, `AudioContext`, `document`) are handled automatically via a **Puppeteer browser bridge**. The server tries its native Node.js handler chain first; if no path is found, it transparently falls back to launching headless Chromium and running the conversion there using the full handler set.

This means conversions like PDF → PNG (via Canvas), SVG tracing, Three.js rendering, audio synthesis, and many others work out of the box — no special handling needed from the caller.

### Requirements for the browser bridge

- A production build must be present: run `bun run build` from the repo root before starting the MCP/API server.
- Puppeteer (already a dev dependency) must be accessible — it is when running from a repo clone.
- The `bunx frogconvert` quick-start **does not** include the browser bridge (no `dist/` is present without a clone and build step).

### How to detect browser-assisted paths

- `find_conversion_path` / `GET /path`: if no native path exists but the browser bridge can handle it, the response will indicate a browser-assisted path is available rather than returning an error.
  - MCP: returns text `"No native path found. A browser-assisted path is available — use convert_file to convert via the browser bridge."`
  - REST: returns `{ "browserAssisted": true, "message": "..." }` (HTTP 200)
- `convert_file` / `POST /convert`: the fallback is automatic — if the native path fails, the browser bridge is tried silently. The caller gets back the converted file(s) just like a native conversion.

### General fallback strategy for agents

| Situation | Action |
|-----------|--------|
| `GET /path` returns `browserAssisted: true` | Browser bridge will handle it — call `POST /convert` normally |
| `GET /path` returns 404 | No path available at all (neither native nor browser) |
| `POST /convert` returns 422 | No path found even via browser bridge |
| Format needs native binaries not in PATH | Check `/health` handler list; install missing tool |
| FFmpeg not found | `winget install ffmpeg` / `brew install ffmpeg` — bundled fallback activates automatically |
| Browser bridge fails to start | Ensure `bun run build` has been run and `dist/` exists |

---

## 🛠️ Developing on frogConvert

For architecture details, handler authoring rules, and the full file structure, see [`AGENT_CONTEXT.md`](AGENT_CONTEXT.md). The key points relevant to the MCP/API environment:

- The MCP server runs in **Node.js**, loading handlers where `requiresMainThread` is unset or `false`. Handlers that need browser APIs are not loaded natively, but are available via the Puppeteer browser bridge (see above).
- WASM `fetch` calls are polyfilled in `src/mcp/core/polyfills.ts` to read files from disk rather than a dev server.
- `batToExeHandler` is excluded from both MCP and REST API (uses Vite-specific `?url` imports incompatible with Node.js). It remains available in the browser UI.
- The browser bridge entry point lives in `src/headless/index.ts` and is built as a separate Vite MPA entry to `dist/headless/`. The bridge implementation is in `src/mcp/core/browserBridge.ts`.
