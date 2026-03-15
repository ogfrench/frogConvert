# AGENTS.md — AI Agent Guide for frogConvert

frogConvert is a universal file converter built as a fork of [Convert to it!](https://github.com/p2r3/convert). It includes a built-in Model Context Protocol (MCP) server — an addition exclusive to this fork — that provides AI agents with direct programmatic access to its core file conversion engine.

Instead of interacting with the frontend web UI, **agents should always use the MCP server to convert files**, discover formats, and analyze conversion paths.

---

## 🚀 Using frogConvert via MCP

The local MCP server wraps frogConvert's complex graph-based routing engine into three easy-to-use tools over a standard `stdio` interface.

### Starting the Server
Start the MCP server locally with:
```bash
bun run mcp
```
*(This executes `bun src/mcp/index.ts`)*

### Exposed MCP Tools

1. **`list_formats`**
   - **Description**: Returns a JSON mapping of all supported input and output formats available in the Node.js environment.
   - **Usage**: Use this to see what extensions and MIME types are currently supported.

2. **`find_conversion_path`**
   - **Arguments**: `inputMime`, `inputExtension`, `outputMime`, `outputExtension`
   - **Description**: Uses frogConvert's `TraversionGraph` algorithm to calculate the step-by-step handler chain required to convert from the input to the output.
   - **Returns**: A visual string representation of the path (e.g. `FFmpeg (audio/wav) -> pandoc (document/csv)`). Returns an error if no path exists.

3. **`convert_file`**
   - **Arguments**: `fileName`, `base64Bytes`, `inputMime`, `inputExtension`, `outputMime`, `outputExtension`
   - **Description**: The core execution tool. Accepts a Base64 encoded file buffer, routes it through the handler chain, and returns all output files.
   - **Returns**: A JSON string (inside a `text` content block) that parses to an array of output files:
     ```json
     [{ "fileName": "output.png", "base64Bytes": "<base64>" }]
     ```
     The array contains multiple entries when a conversion produces multiple output files (e.g. a multi-page PDF split into individual images).

---

## 🌐 Using frogConvert via REST API

A local HTTP REST API is also available as an alternative to MCP — useful for shell scripts, curl, or any HTTP client.

### Starting the Server
```bash
bun run api
```
*(This executes `bun src/api/index.ts` and binds to `http://127.0.0.1:3000`)*

Set `PORT` env var to override the port: `PORT=8080 bun run api`

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

## 🛠️ Developing on frogConvert

If you are tasked with expanding frogConvert's capabilities, here is how the conversion engine operates under the hood.

### Architecture
frogConvert relies on **Handlers** and a **TraversionGraph**:
- **Handlers** (`src/handlers/*`): Individual modules wrapping underlying conversion libraries (e.g., FFmpeg WASM, ImageMagick WASM, Pandoc). Each handler implements the `FormatHandler` interface (`src/core/FormatHandler/FormatHandler.ts`).
- **TraversionGraph** (`src/core/TraversionGraph/TraversionGraph.ts`): Uses Dijkstra's algorithm to compute the cheapest conversion path between formats using the edges provided by initialized handlers.

### The MCP Environment constraints
The web application of frogConvert chains handlers that might rely on browser APIs (like `Canvas`, `DOM`, `window`). 
**The MCP server (`src/mcp/index.ts`) runs in Node.js.** Therefore:
1. The MCP registry (`src/mcp/core/handlers.ts`) **strictly excludes** browser-only handlers.
2. Only handlers capable of running purely in Node.js or via Node-compatible WASM (like `FFmpegHandler` and `ImageMagickHandler`) are registered.
3. WASM asset `fetch` calls are polyfilled (`src/mcp/core/polyfills.ts`) to read local files from the repository (`node_modules` or `src/`) instead of relying on a development server URL.

### Adding a New Handler
If asked to add support for a new format:
1. Write a new handler class in `src/handlers/`. Choose the right base class:
   - Extend `TextFormatHandler` (`src/core/FormatHandler/TextFormatHandler.ts`) for text-based formats (JSON, CSV, XML, YAML, etc.) — it handles the `Uint8Array ↔ string` decode/encode pipeline for you. Implement `doConvertText()` instead of `doConvert()`.
   - Extend `BaseHandler` (`src/core/FormatHandler/BaseHandler.ts`) for anything else — it provides a default `init()`, a `replaceExtension()` helper, and keeps `ready = true` by default.
   - Implement the raw `FormatHandler` interface directly only if you need maximum control (e.g., async `init()` that loads WASM).
2. Use the `CommonFormats` utility (`src/core/CommonFormats/CommonFormats.ts`) to declare `supportedFormats`.
3. Set `requiresMainThread`:
   - If the handler uses only pure computation or Node-compatible WASM (no `Canvas`, `document`, `AudioContext`, `WebGL`): leave it unset or `false`. The engine will run it in a Web Worker.
   - If the handler requires browser-only DOM APIs: set `public requiresMainThread = true`. The engine will keep it on the main thread.
4. If the handler relies **only** on Node-compatible APIs or WASM:
   - Export and register it in `src/mcp/core/handlers.ts` to make it available to the MCP server.
5. If the handler requires WASM files, add an interception rule in `src/mcp/core/polyfills.ts` so `fetch()` can read the WASM file from disk.

### File Structure
```text
src/
├── core/
│   ├── FormatHandler/      # Core interfaces and base classes
│   │   ├── FormatHandler.ts    # FormatHandler interface, FileFormat, FileData types
│   │   ├── BaseHandler.ts      # Abstract base class (default init, replaceExtension helper)
│   │   └── TextFormatHandler.ts# Base class for text formats (auto decode/encode)
│   ├── CommonFormats/      # Constants for defining MIME types and extensions
│   └── TraversionGraph/    # Pathfinding graph algorithm
├── components/             # The Vanilla TS/CSS User Interface
│   ├── store/              # Reactive state, UI references, format mode logic
│   ├── utils.ts            # Shared utilities (escapeHTML, formatBytes, ensureMinDuration)
│   └── utils/
│       └── ModalManager.ts # Centralized modal lifecycle (open/close, focus, scroll-lock)
├── handlers/               # The actual conversion logic (FFmpeg, ImageMagick, Pandoc, etc.)
├── workers/
│   ├── conversion.worker.ts    # Executes handler conversions in a background thread
│   └── route-search.worker.ts  # Runs Dijkstra pathfinding in a background thread
├── mcp/                    # MCP Server (stdio) — `bun run mcp`
│   ├── index.ts            # Entry point
│   ├── core/
│   │   ├── handlers.ts     # Node.js-compatible handler registry (shared with API)
│   │   ├── polyfills.ts    # Fetch polyfills for loading WASM locally (shared with API)
│   │   └── utils.ts        # findFormatAndHandler() helper (shared with API)
│   └── tools/              # MCP tool registrations
│       ├── convertFile.ts
│       ├── findConversionPath.ts
│       └── listFormats.ts
└── api/                    # Local HTTP REST API — `bun run api`
    ├── index.ts            # Entry point (Bun.serve on 127.0.0.1:3000)
    └── routes/
        ├── formats.ts      # GET /formats
        ├── path.ts         # GET /path
        └── convert.ts      # POST /convert
```

> **Note:** `batToExeHandler` is excluded from both MCP and REST API because it uses Vite-specific `?url` binary imports that are incompatible with Node.js/Bun direct execution. It remains available in the browser web UI.
