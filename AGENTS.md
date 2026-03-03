# AGENTS.md — AI Agent Guide for frogConvert

This document serves two purposes:
1. **Using frogConvert as a tool** — How to convert files via the web app at [frogconvert.xyz](https://frogconvert.xyz/) (Backup: [frogconvert.netlify.app](https://frogconvert.netlify.app/)).
2. **Developing on frogConvert** — How the codebase works for agents making code changes.

---

## Using frogConvert (Web Tool)

**URL:** https://frogconvert.xyz/ 
**Backup URL:** https://frogconvert.netlify.app/

frogConvert is a free, privacy-first file converter that runs entirely in the browser. No files are uploaded to any server. It supports conversion between hundreds of formats across all media types — images, audio, video, documents, archives, fonts, code, data, and more.

### When to Use frogConvert

Use frogConvert when you need to:
- Convert a file between formats (e.g. PNG to SVG, WAV to MP3, DOCX to PDF)
- Perform cross-media conversions that most tools can't (e.g. AVI to PDF, MIDI to WAV, JSON to YAML)
- Convert files without uploading them to a third-party server (privacy-sensitive scenarios)
- Batch convert multiple files at once

### How to Convert a File

1. **Go to** https://frogconvert.xyz/ (or the fallback https://frogconvert.netlify.app/)
2. **Upload** — Drag and drop files onto the upload zone, or click it to browse. Multiple files are supported.
3. **Input format is auto-detected** — The app reads your file and selects the matching input format automatically. The category tab (Image, Audio, Video, etc.) switches to match.
4. **Select output format** — Click the format selector to open the format picker. You can:
   - Browse formats by category using the tabs (Image, Audio, Video, Document, etc.)
   - Search for a specific format by name using the search bar
   - Toggle between "Simple" mode (common formats) and "All" mode (every supported format)
5. **Click Convert** — The convert button starts the process. A progress indicator shows completion status.
6. **Download** — The converted file downloads automatically when finished.

### Key Capabilities

- **Any-to-any conversion** — frogConvert chains multiple conversion tools together via graph-based pathfinding. If no single tool can convert directly between two formats, it finds a multi-step path automatically.
- **Cross-media** — Convert between entirely different media types. Video to image, audio to document, data to code — it will find a path if one exists.
- **Batch processing** — Upload and convert multiple files in one go.
- **Client-side only** — All processing happens in your browser using WebAssembly-powered tools (FFmpeg, ImageMagick, Pandoc, etc.). Nothing leaves your machine.
- **Format categories** — image, video, audio, text, document, data, vector, archive, spreadsheet, presentation, font, code.

### Limitations

- **Large files** — The app runs in-browser, so available RAM limits file size. It auto-detects device capabilities and warns when limits are exceeded.
- **Processing speed** — Complex conversions (especially video) are slower than native tools since they run via WebAssembly in the browser.
- **No API** — frogConvert is a web UI only. There is no REST API or CLI for programmatic access.

---

## Developing on frogConvert (Codebase Guide)

## Project Overview

frogConvert is a browser-based universal file converter. It runs entirely client-side — no server uploads. It chains multiple conversion "handlers" together using a graph-based pathfinding algorithm to convert between any two formats, even across media types (e.g. video to PDF).

**Stack:** TypeScript, Vite, vanilla DOM (no framework), Vitest for tests, Bun as the package manager.

## Directory Structure

```
src/
├── main.ts                          # App entry point, wires UI to conversion logic
├── global.d.ts                      # Global type declarations
├── styles/                          # Global CSS
├── core/
│   ├── FormatHandler/
│   │   ├── FormatHandler.ts         # Core interfaces: FormatHandler, FileFormat, FileData
│   │   └── PriorityQueue.ts         # Priority queue for pathfinding
│   ├── CommonFormats/
│   │   └── CommonFormats.ts         # Reusable FormatDefinition constants (PNG, JPEG, JSON, etc.)
│   ├── TraversionGraph/
│   │   ├── TraversionGraph.ts       # Graph-based pathfinding for chaining conversions
│   │   └── TraversionGraph.test.ts
│   └── utils/
│       └── normalizeMimeType.ts     # MIME type normalization utility
├── components/                      # UI components (vanilla TS + CSS modules)
│   ├── store/store.ts               # Shared UI state, DOM refs, constants
│   ├── UploadZone/                  # File upload drag-and-drop area
│   ├── FormatModal/                 # Format picker modal with search
│   ├── CategoryTabs/                # Category tab navigation
│   ├── ConversionModal/             # Conversion progress display
│   ├── FilesModal/                  # Multi-file management modal
│   ├── TopBar/                      # Top navigation bar
│   ├── Popup/                       # Generic popup component
│   └── CustomCursor/                # Custom cursor effect
├── effects/
│   └── Confetti/                    # Confetti animation effect
├── handlers/                        # All conversion handlers (the bulk of the codebase)
│   ├── index.ts                     # Handler registry — imports and exports all handlers
│   ├── FFmpeg.ts                    # FFmpeg-based audio/video conversions
│   ├── ImageMagick.ts               # ImageMagick-based image conversions
│   ├── pandoc.ts                    # Pandoc-based document conversions
│   ├── jszip.ts                     # ZIP archive handling
│   ├── canvasToBlob.ts              # Canvas-based image format conversions
│   └── ...                          # ~40+ additional specialized handlers
├── test/                            # Test resources and setup
vite.config.js                       # Vite config with WASM static copy targets
tsconfig.json                        # TypeScript config
package.json                         # Dependencies and scripts
```

## Key Concepts

### FormatHandler Interface

Every conversion tool implements `FormatHandler` (defined in `src/core/FormatHandler/FormatHandler.ts`):

```ts
interface FormatHandler {
  name: string;                    // Tool name (e.g. "FFmpeg")
  supportedFormats?: FileFormat[]; // Formats this handler can convert to/from
  supportAnyInput?: boolean;       // Accepts any input type (fallback handler)
  ready: boolean;                  // Set to true after init()
  init(): Promise<void>;           // Initialize the handler, populate supportedFormats
  doConvert(inputFiles, inputFormat, outputFormat, args?): Promise<FileData[]>;
}
```

### FileFormat and CommonFormats

`FileFormat` describes a file format with fields: `name`, `format`, `extension`, `mime`, `from`, `to`, `internal`, `category`, `lossless`.

Use `CommonFormats` (`src/core/CommonFormats/CommonFormats.ts`) to avoid boilerplate. It provides predefined `FormatDefinition` objects with a builder pattern:

```ts
CommonFormats.PNG.builder("png").allowFrom().allowTo().markLossless()
```

Categories: `image`, `video`, `audio`, `text`, `document`, `data`, `vector`, `archive`, `spreadsheet`, `presentation`, `font`, `code`.

### TraversionGraph

The graph in `src/core/TraversionGraph/TraversionGraph.ts` builds edges from every handler's supported formats and uses Dijkstra's algorithm to find the cheapest conversion path. It considers category changes, lossiness, and handler priority when computing edge costs. This means handlers don't need to support direct conversion between every pair — the system chains them automatically.

### Handler Loading

Handlers are loaded in two phases (see `src/main.ts`):
1. **Phase 1 (core):** Statically imported handlers loaded synchronously at startup.
2. **Phase 2 (background):** Dynamically imported handlers loaded asynchronously after the UI is ready.

The registry is in `src/handlers/index.ts`. Core handlers are in the top section; background handlers are in `loadBackgroundHandlers()`.

## Common Tasks

### Adding a New Handler

1. Create `src/handlers/yourhandler.ts` implementing `FormatHandler`.
2. Name the class `yourhandlerHandler` and set `this.name` to `"yourhandler"`.
3. In `init()`, populate `this.supportedFormats` using `CommonFormats` builders or raw `FileFormat` objects. Set `this.ready = true`.
4. Implement `doConvert()` to perform the actual conversion. Set output file names (swap the extension). Clone byte buffers with `new Uint8Array(buffer)` if the handler might mutate them.
5. Register the handler in `src/handlers/index.ts`:
   - For core handlers: add a static import and `handlers.push(new yourhandlerHandler())` at the top.
   - For non-core handlers: add a dynamic import entry in `loadBackgroundHandlers()`.
6. If the handler needs WASM or other static assets, add a `viteStaticCopy` target in `vite.config.js`.

### Adding a New Format to an Existing Handler

Open the handler file and add a new entry to `this.supportedFormats` in `init()`. Use `CommonFormats` if a definition already exists, or define a raw `FileFormat` object.

### Modifying UI Components

Components live in `src/components/`. Each component is a folder with a `.ts` file and a `.css` file. There is no framework — components use vanilla DOM manipulation. Shared state and DOM references are in `src/components/store/store.ts`.

### Running Tests

```bash
bun run test        # Run all tests once
bun run test:watch  # Watch mode
```

Tests use Vitest with jsdom. Test files are colocated with their source as `*.test.ts`.

### Building

```bash
bun run build       # Production build (tsc + vite build)
bun run dev         # Dev server
```

## Important Conventions

- **Naming:** Handler file is `yourhandler.ts`, class is `yourhandlerHandler`, `name` property is `"yourhandler"`.
- **MIME normalization:** Always run MIME types through `normalizeMimeType()` from `src/core/utils/normalizeMimeType.ts`.
- **Media-first thinking:** Treat files as the media they represent, not the data they contain. An SVG is an image, not XML.
- **Buffer safety:** Handlers must not mutate input byte buffers. Clone with `new Uint8Array()` when needed.
- **No CDNs:** Install dependencies via npm/bun or add as git submodules. Avoid CDN links.
- **WASM assets:** Add to `viteStaticCopy` targets in `vite.config.js`, served under `/convert/wasm/`.
- **Format cache:** The app caches supported formats in localStorage. During development, use `printSupportedFormatCache()` in the browser console to generate a `cache.json` for faster startup.
