# frogConvert: Comprehensive Agent Context

This document is the definitive guide for any AI agents (or developers) working on the frogConvert project. It provides deep architectural details, specific file structures, and critical rules for maintaining the integrity and responsiveness of the application.

---

## 1. What is frogConvert?

frogConvert is a high-performance, privacy-first file conversion web platform built entirely for client-side execution. It is a fork of [Convert to it!](https://github.com/p2r3/convert) by PortalRunner. The core conversion engine — the `FormatHandler` interface, handler pattern, and `TraversionGraph` algorithm — is inherited from the original project.

**What frogConvert adds on top:**
- Fully redesigned Vanilla TS/CSS UI with light/dark mode and mobile-first layout.
- File management modal, upload limits, and per-device RAM detection.
- MCP (Model Context Protocol) server for programmatic AI agent access (`src/mcp/`).
- Web Workers for pathfinding (`route-search.worker.ts`) and handler execution (`conversion.worker.ts`).
- `requiresMainThread` flag on `FormatHandler` to safely route DOM-dependent handlers away from workers.
- 3-tier format mode system (Core / Plus / All) controlling which formats are visible in the picker.
- `BaseHandler` and `TextFormatHandler` base classes for cleaner handler authoring.
- Centralized `ModalManager` for all popup/modal lifecycle (focus, scroll-lock, keyboard escape).
- Partial download support for cancelled batch conversions.
- Full vitest unit test suite and Puppeteer E2E tests.
- Bun-based build system (original uses npm/tsx).

Everything runs in the browser, eliminating the need for server-side processing or data uploads. It achieves its conversion breadth by leveraging:
- **WebAssembly (WASM)** ports of powerful CLI tools (e.g., FFmpeg, ImageMagick).
- **Specialized JavaScript Libraries** for parsing and encoding formats (e.g., `jszip`, `three.js`, `meyda`).
- **Web Workers** for offloading heavy, synchronous computations to keep the main UI thread lag-free.
- **A Dynamic Graph Algorithm** to plot conversion paths between formats when a direct 1:1 converter doesn't exist.

---

## 2. Directory Structure & Responsibilities

The codebase is organized as a vanilla TypeScript Vite project. Here are the most critical domains:

- **`src/handlers/`**: The core engines of conversion. Every file here implements the `FormatHandler` interface for a specific tool or file group.
  - Examples: `ffmpeg.ts`, `imageMagick.ts`, `json.ts`, `textEncoding.ts`, `sppd.ts`.
- **`src/core/`**: The brains of the application.
  - **`FormatHandler/`**: Contains the interfaces `FormatHandler`, `FileFormat`, and `FileData`.
  - **`TraversionGraph/`**: The Dijkstra-based pathfinding engine that figures out how to chain handlers together (e.g., PNG → CanvasToBlob → BMP → FFmpeg → MP4).
- **`src/workers/`**: Contains `conversion.worker.ts` (executes handler `doConvert` calls off the main thread) and `route-search.worker.ts` (runs Dijkstra pathfinding in a background thread). Both communicate via message-passing. See the `requiresMainThread` flag on handlers to determine which can run in a worker.
- **`src/components/`**: The Vanilla TS/CSS User Interface.
  - **`ConversionModal/`**: Manages the conversion progress popup state machine (`ConversionModal.ts`) and orchestrates the full conversion flow (`ConversionActions.ts`).
  - **`FormatModal/`**: The UI for selecting output formats, including the 3-tier format mode system (Core / Plus / All).
  - **`store/`**: Lightweight reactive wrappers storing shared state (active files, UI references, `formatMode`, `isCategoryVisible`, `isFormatVisible`, `updateScrollLock`).
  - **`utils.ts`**: Shared utilities — `escapeHTML`, `formatBytes`, `shortenFileName`, `ensureMinDuration`.
  - **`utils/ModalManager.ts`**: Centralized open/close lifecycle for all modals.
- **`src/mcp/`**: Model Context Protocol integration. This allows frogConvert's engine to be exposed to connected AI assistants as a suite of external tools securely.
- **`test/`**:
  - `e2e/`: Puppeteer end-to-end tests ensuring heavy UI flows and workers do not break.

---

## 3. Deep Dive: Format Handlers

Every handler must conform to the `FormatHandler` interface (defined in `src/core/FormatHandler/FormatHandler.ts`):

```typescript
export interface FormatHandler {
    name: string;
    supportedFormats?: FileFormat[]; // Defines from/to compatibility
    ready: boolean; // Flag indicating init completion
    requiresMainThread?: boolean; // CRITICAL FLAG
    init: () => Promise<void>; // Fetch assets, load WASM, setup contexts
    doConvert: (inputFiles: FileData[], inputFormat: FileFormat, outputFormat: FileFormat, args?: string[]) => Promise<FileData[]>;
}
```

### Base Classes (prefer these over raw `FormatHandler`)

Two abstract base classes live in `src/core/FormatHandler/`:

- **`BaseHandler`** — implements `ready = true`, a no-op `init()`, and a `replaceExtension(filename, ext)` helper. Use this when your handler needs a custom `doConvert()` but doesn't deal with WASM loading.
- **`TextFormatHandler extends BaseHandler`** — additionally handles the `Uint8Array → string → Uint8Array` decode/encode pipeline. Instead of `doConvert()`, implement `doConvertText(inputTexts, inputFormat, outputFormat)` which receives plain strings and returns plain strings. Use this for JSON, CSV, XML, YAML, source code, and any other text-based format.

### The `requiresMainThread` Rule
This flag governs whether a handler blocks the UI.
- **`false` or `undefined` (Preferred):** 
  The handler executes entirely within `src/workers/conversion.worker.ts`. It takes in `Uint8Array` bytes, computes, and returns bytes. This MUST be used for heavy WASM operations (FFmpeg, ImageMagick).
- **`true`:**
  The handler requires DOM-exclusive APIs (`HTMLCanvasElement`, `XMLSerializer`, `AudioContext`, `WebGL`). It cannot run in a worker and must be executed on the main thread safely.
  *Examples:* `canvasToBlob.ts` (Image encoding), `svgTrace.ts`, `sppd.ts` (3D Context), `meyda.ts` (Audio analysis).

### Initialization & Assets
Handlers often fetch massive WASM blobs. This is done inside `init()`. Handlers should be Lazy; do not perform heavy initialization at the top level of the file. Wait until the application explicitly calls `init()`.

---

## 4. Deep Dive: The Traversion Graph

frogConvert doesn't hardcode "PNG to MP4 goes through FFmpeg". Instead, handlers define what they take and output globally via `FileFormat` objects.

When a user asks to convert Format A to Format C, the `TraversionGraph` offloads a Dijkstra search to `src/workers/route-search.worker.ts`, keeping the UI thread free:
1. It builds nodes for every registered `FileFormat`.
2. It builds directed edges between nodes where a `FormatHandler` implements the path.
3. **Edge Costs & Heuristics**:
   - **Base Cost**: Simple conversions are cheap.
   - **Initialization Cost**: Handlers like FFmpeg have a high "boot" cost added to the first edge.
   - **Category Change Penalty**: Stepping between categories (e.g., Image → Video) carries a high penalty (e.g., 10,000) to prioritize intra-category paths.
   - **Lossy Penalty**: Converting to a lossy format adds cost to preserve quality where possible.

---

## 5. UI and State Management Principles

frogConvert deliberately **does not use React or Vue**. It is a Vanilla TS + DOM application geared for extreme performance and tiny bundle sizes.

### State Reactivity
State is managed in `src/components/store/store.ts` using a "Value Wrapper" pattern:
```typescript
export const currentFiles: { value: File[] } = { value: [] };
```
UI components subscribe to or update these `.value` properties manually.

### UI References
Avoid `document.querySelector` inside components. Use the centralized `ui` object in `store.ts` which caches all primary DOM references.

### Popup & Modal Management
- **`Popup.ts`**: Provides `showPopup(content, persistent?)`, `hidePopup()`, `showAlertPopup(title, html)`, `createPopupButton(text, class, onClick)`, and specialised helpers (`showSizeWarningPopup`, `showFileTypeMismatchPopup`). All open/close is delegated to `ModalManager`.
- **`utils/ModalManager.ts`**: Centralized modal lifecycle. Maintains a stack of open modals, manages `open` class toggling, `aria-hidden`, keyboard escape handling (non-persistent modals only), focus trapping, and calls `updateScrollLock()` on every open/close. The three managed modals are `#format-modal`, `#files-modal`, and `#popup`.
- **Visibility contract**: Modals are shown/hidden via the `open` CSS class — never `style.display`. A modal is considered open when its element has `classList.contains("open")`.
- **Spinners**: Active conversions use the gooey spinner (`loader-gooey`); short blocking operations like cancellation use the standard spinner (`loader-spinner`).
- **Cancellation & Partial Downloads**: `isCancelled` flag and related state machine live in `ConversionModal.ts`. If a batch is cancelled, `showPartialDownloadPopup()` offers to download the files that finished.
- **Scroll Locking**: `updateScrollLock()` in `store.ts` checks all three modal elements for the `open` class and toggles `.scroll-lock` on `<html>` accordingly. Called automatically by `ModalManager`.

---

## 6. Model Context Protocol (MCP)

This project functions dual-purpose as both a Web App and an MCP Toolset (`src/mcp/`). 
The MCP Server allows AI Assistants to:
- Detect formats of local files.
- Execute the full conversion engine programmatically.
- It uses specific polyfills (`src/mcp/core/polyfills.ts`) to simulate a browser environment for handlers that are mostly pure but touch minor browser globals.

---

## 7. Mandatory Agent Workflow & Rules

1. **Verify Worker Compatibility**: 
   If you add a new handler, check if it uses `window`, `document`, or `Canvas`. If it does, set `requiresMainThread = true`. Otherwise, ensure it is Worker-safe.
2. **Never Block the Loader**: 
   Any computation > 50ms must be offloaded to `conversion.worker.ts`. Stuttering the loader spinner is considered a critical failure.
3. **Respect Memory Limits**: 
   WASM has hard memory limits (~2-4GB). Always clean up instances (e.g., `magick.dispose()`, `ffmpeg.deleteFile()`) to prevent OOM crashes during batch conversions.
4. **Testing is Required**:
   - **`bun run test`** (runs `bun x vitest run`): Runs unit and integration tests. Do NOT use bare `bun test` — that invokes Bun's native runner which lacks the jsdom environment.
   - **E2E Tests**: `test/e2e/conversion-flow.test.ts` uses Puppeteer to verify that the Web Worker actually mounts and doesn't freeze the browser.
5. **Format Standards**: 
   Use `src/core/CommonFormats/CommonFormats.ts` for all MIME types and extensions. Never hardcode MIME strings if they exist in the common registry.
6. **Shared Utilities**:
   Use `src/components/utils.ts` for common UI tasks (HTML escaping, byte formatting, string shortening) to maintain consistency.
7. **Mobile First**: 
   The application uses a `MOBILE_BREAKPOINT` of 800px. Ensure new UI elements don't break on narrow viewports or coarse pointer (touch) devices.
