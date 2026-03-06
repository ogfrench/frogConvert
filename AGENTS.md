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
   - **Returns**: A visual string representation of the path (e.g. `FFmpeg (audio/wav) -> pandas (document/csv)`). Returns an error if no path exists.

3. **`convert_file`**
   - **Arguments**: `fileName`, `base64Bytes`, `inputMime`, `inputExtension`, `outputMime`, `outputExtension`
   - **Description**: The core execution tool. It accepts a Base64 encoded string of the file buffer, automatically routes it through the necessary handler chain, and returns the converted Base64 encoded bytes. 

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
1. Write a new handler class in `src/handlers/` implementing `FormatHandler`.
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
│   ├── FormatHandler/      # Core interfaces (FormatHandler, FileFormat, FileData)
│   ├── CommonFormats/      # Constants for defining MIME types and extensions
│   └── TraversionGraph/    # Pathfinding graph algorithm
├── handlers/               # The actual conversion logic (FFmpeg, ImageMagick, Pandoc, etc.)
├── workers/                # Web Workers for offloading heavy compute off the main thread
│   ├── conversion.worker.ts    # Executes handler conversions in a background thread
│   └── route-search.worker.ts  # Runs Dijkstra pathfinding in a background thread
└── mcp/                    # MCP Server implementation
    ├── index.ts            # Entry point for `bun run mcp`
    ├── core/
    │   ├── handlers.ts     # The Node.js compatible handler registry
    │   └── polyfills.ts    # Fetch polyfills for loading WASM locally
    └── tools/              # Tool execution logic
        ├── convertFile.ts
        ├── findConversionPath.ts
        └── listFormats.ts
```
