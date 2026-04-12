<!-- docs-frontmatter
icon: ⚙️
label: Contributing
desc: Code and handler guidelines
-->

# Contributing to frogConvert

This guide is for developers and AI agents looking to extend frogConvert by adding new handlers, fixing bugs, or improving the core engine.

For a high-level conceptual overview, see **[ARCHITECTURE.md](ARCHITECTURE.md)**. For API and integration details, see **[INTEGRATIONS.md](INTEGRATIONS.md)**.

---

## 1. Directory Structure

The codebase is organized as a vanilla TypeScript Vite project. Detailed responsibilities are documented in **[ARCHITECTURE.md](ARCHITECTURE.md)**.

---

## 2. Deep Dive: Format Handlers

Every handler must conform to the `FormatHandler` interface (defined in `src/core/FormatHandler/FormatHandler.ts`):

```typescript
export interface FormatHandler {
    name: string;
    supportedFormats?: FileFormat[]; // Defines from/to compatibility
    supportAnyInput?: boolean; // If true, handler accepts any input type (used as a last-resort fallback)
    ready: boolean; // Flag indicating init completion
    requiresMainThread?: boolean; // CRITICAL FLAG
    init: () => Promise<void>; // Fetch assets, load WASM, setup contexts
    doConvert: (inputFiles: FileData[], inputFormat: FileFormat, outputFormat: FileFormat, args?: string[]) => Promise<FileData[]>;
}
```

### Base Classes (prefer these over raw `FormatHandler`)

Two abstract base classes live in `src/core/FormatHandler/`:

- **`BaseHandler`** - implements `ready = true`, an `init()` that sets `ready = true`, and a `replaceExtension(filename, ext)` helper. Use this for handlers that don't need async initialization - `supportedFormats` must be defined at class level. **Do not use for WASM handlers** - those implement `FormatHandler` directly, start with `ready = false`, and set `supportedFormats` inside `init()`.
- **`TextFormatHandler extends BaseHandler`** - additionally handles the `Uint8Array → string → Uint8Array` decode/encode pipeline. Instead of `doConvert()`, implement `doConvertText(inputTexts, inputFormat, outputFormat)` which receives `{ name: string, text: string }[]` objects and returns the same. Use this for JSON, CSV, XML, YAML, source code, and any other text-based format.

### The `requiresMainThread` Rule
This flag governs whether a handler blocks the UI.
- **`false` or `undefined` (Preferred):** 
  The handler executes entirely within `src/workers/conversion.worker.ts`. It takes in `Uint8Array` bytes, computes, and returns bytes. This MUST be used for heavy WASM operations (FFmpeg, ImageMagick).
- **`true`:**
  The handler requires DOM-exclusive APIs (`HTMLCanvasElement`, `XMLSerializer`, `AudioContext`, `WebGL`). It cannot run in a worker and must be executed on the main thread safely.
  *Examples:* `canvasToBlob.ts` (Image encoding), `svgTrace.ts`, `sppd.ts` (3D Context), `meyda.ts` (Audio analysis).

### Adding a New Handler

Each "tool" used for conversion has to be normalized to a standard form - effectively a "wrapper" that abstracts away the internal processes. These wrappers are available in [src/handlers](src/handlers/).

Below is a barebones handler skeleton using the raw `FormatHandler` interface (the WASM/async-init pattern). For simple, non-WASM handlers, prefer extending `BaseHandler` instead:

```ts
// file: dummy.ts

import type { FileData, FileFormat, FormatHandler } from "../core/FormatHandler/FormatHandler.ts";
import CommonFormats from "../core/CommonFormats/CommonFormats.ts";

class dummyHandler implements FormatHandler {

  public name: string = "dummy";
  public supportedFormats?: FileFormat[];
  public ready: boolean = false;

  async init () {
    this.supportedFormats = [
      // Use a CommonFormats entry with the builder pattern:
      CommonFormats.PNG.builder("png")
        .markLossless()
        .allowFrom(true)
        .allowTo(true),

      // Alternatively, if you need a custom format not in CommonFormats:
      {
        name: "CompuServe Graphics Interchange Format (GIF)",
        format: "gif",
        extension: "gif",
        mime: "image/gif",
        from: true,
        to: true,
        internal: "gif",
        category: ["image", "video"],
        lossless: false
      },
    ];
    this.ready = true;
  }

  async doConvert (
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {
    const outputFiles: FileData[] = [];
    return outputFiles;
  }

}

export default dummyHandler;
```

#### Quality Presets

Handlers that support variable output quality should check for a `--quality` flag in the `args` parameter. The `extractQualityPreset(args)` utility (from `FormatHandler.ts`) returns one of `"low" | "medium" | "high" | "lossless"` or `undefined`. Map these to your tool's specific encoding settings (e.g. FFmpeg maps to CRF/bitrate, ImageMagick maps to quality 60-100, pdftoimg maps to DPI and JPEG quality).

#### Multi-File Output

Some conversions produce multiple output files (e.g. frame extraction from animated GIF, video→PNG sequence, multi-size ICO bundles). Return all files from `doConvert()` as separate `FileData` entries. When there are multiple outputs, name them with an index suffix (e.g. `frame_1.png`, `frame_2.png`). The UI automatically zips multi-file results for download.

#### Conversion Warnings

If a handler silently adjusts the output (padding dimensions, coercing sample rates, upscaling), add human-readable warning strings to `FileData.warnings`. These surface in the UI success popup and in MCP/API responses.

#### Important Implementation Rules:

- **Naming**: If your tool is called `dummy`, the class must be `dummyHandler` and the file `dummy.ts`.
- **Output Names**: The handler is responsible for setting the output file's name (usually just swapping the extension).
- **Immutability**: Byte buffers entering or exiting the handler must not be mutated. Clone them if necessary.
- **MIME Normalization**: Use `normalizeMimeType.ts` to ensure consistency.
- **Main Thread**: If the handler uses DOM APIs (Canvas, AudioContext), set `requiresMainThread: true`.
- **Initialization**: Keep `init()` lazy - do not load WASM blobs until it is called.

### Builder API Reference

The `FormatDefinition.builder(ref)` method returns a chainable builder for creating `FileFormat` objects. All methods return `this` for chaining:

| Method | Description |
|---|---|
| `.allowFrom(value?)` | Enable/disable conversion **from** this format. Default: `true` when called without args. |
| `.allowTo(value?)` | Enable/disable conversion **to** this format. Default: `true` when called without args. |
| `.markLossless(value?)` | Mark the format as lossless in this handler's context. Default: `true` when called without args. |
| `.named(name)` | Override the display name (long description shown to the user). |
| `.withFormat(format)` | Override the short format identifier. |
| `.withExt(ext)` | Override the file extension. |
| `.withMime(mime)` | Override the MIME type. |
| `.withCategory(category)` | Replace the format's category (string or string array). |
| `.override(values)` | Bulk override any `IFormatDefinition` fields. |

Example - reusing a CommonFormats entry but overriding the display name:
```ts
CommonFormats.PNG.builder("png-hd")
  .named("PNG (High-Density)")
  .allowFrom(true)
  .allowTo(true)
  .markLossless()
```

### Registering Your Handler

After creating your handler file in `src/handlers/`, you need to register it in `src/handlers/index.ts`. There are two patterns:

**Dynamic import (preferred for most handlers)** - the handler is loaded asynchronously after the page starts. This keeps the initial bundle small:
```ts
// In the loaders array inside loadBackgroundHandlers()
async () => { const m = await import("./myHandler.ts"); handlers.push(new m.default()); },
```

**Static import (core handlers only)** - used for handlers that must be available immediately at startup (e.g., `canvasToBlob`, `jszip`). These are bundled into the main chunk:
```ts
import myHandler from "./myHandler.ts";
// ...
try { handlers.push(new myHandler()) } catch (e) { console.warn('[handlers] Failed to load myHandler:', e); }
```

Use dynamic import unless your handler is needed for the initial format graph or is a dependency of other core components. If your file exports multiple handler instances (like `midi.ts` or `rename.ts`), push them all in a single loader:
```ts
async () => { const m = await import("./midi.ts"); handlers.push(new m.midiCodecHandler(), new m.midiSynthHandler()); },
```

### Adding Dependencies

- **NPM**: Use `bun add`.
- **Git**: Add as a submodule to `src/handlers`.
- **CDNs**: Avoid them. They are unstable and don't play well with the offline-first/CLI nature of the project.
- **WASM**: Add paths to `vite.config.js` and target `/wasm/`.

---

## 3. Deep Dive: The Traversion Graph

frogConvert doesn't hardcode "PNG to MP4 goes through FFmpeg". Instead, handlers define what they take and output globally via `FileFormat` objects.

When a user asks to convert Format A to Format C, the `TraversionGraph` offloads a Dijkstra search to `src/workers/route-search.worker.ts`, keeping the UI thread free:
1. It builds nodes for every registered `FileFormat`.
2. It builds directed edges between nodes where a `FormatHandler` implements the path.
3. **Edge Costs & Heuristics**:
   - **Base Cost**: Simple conversions are cheap.
   - **Initialization Cost**: Handlers like FFmpeg have a high "boot" cost added to the first edge.
   - **Category Change Penalty**: Stepping between categories carries a cost that varies by pair (e.g., Image→Video is nearly free at 0.2; Image→Audio is expensive at ~1.4). Certain three-step sequences (e.g., audio→video→image) receive an extreme adaptive penalty of 10,000 to prevent absurd multi-hop paths.
   - **Lossy Penalty**: Converting to a lossy format adds cost to preserve quality where possible.

---

## 4. UI and State Management Principles

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
- **Visibility contract**: Modals are shown/hidden via the `open` CSS class - never `style.display`. A modal is considered open when its element has `classList.contains("open")`.
- **Spinners**: Active conversions use the gooey spinner (`loader-gooey`); short blocking operations like cancellation use the standard spinner (`loader-spinner`).
- **Cancellation & Partial Downloads**: `isCancelled` flag and related state machine live in `ConversionModal.ts`. If a batch is cancelled, `showPartialDownloadPopup()` offers to download the files that finished.
- **Scroll Locking**: `updateScrollLock()` in `store.ts` checks all three modal elements for the `open` class and toggles `.scroll-lock` on `<html>` accordingly. Called automatically by `ModalManager`.

---

## 5. Format Mode System (Core / Plus / All)

The format picker exposes three visibility tiers that filter which output formats users see. This is configured in `src/components/store/store.ts`:

- **Core** - common everyday formats only. Formats must appear in the `CORE_FORMATS` whitelist **and** their category must not be in `CORE_HIDDEN_CATEGORIES` (hidden: `data`, `font`, `code`, `other`).
- **Plus** - adds data, font, and extra media formats. Uses the `PLUS_FORMATS` whitelist (superset of `CORE_FORMATS`) and `PLUS_HIDDEN_CATEGORIES` (hidden: `code`, `other`).
- **All** - shows every registered format with no filtering.

If your new handler's formats don't appear in Core or Plus mode, you need to add the format's `format` string (the short identifier, e.g. `"png"`, `"csv"`) to the relevant `Set` in `store.ts`. The user's selected mode is persisted in `localStorage`.

---

## 6. Cache System

frogConvert uses a pre-computed format cache (`public/cache.json`) to avoid calling every handler's `init()` at startup. Without it, the first page load is slow because each WASM handler must be loaded to discover its supported formats.

### How it works
1. **Build time**: `bun run cache:build` launches Puppeteer, loads the built site, waits for all handlers to initialize, then calls `window.printSupportedFormatCache()` to serialize the handler→formats mapping.
2. **Runtime**: The app loads `cache.json` and builds the `TraversionGraph` immediately from cached format data, without calling `init()` on any handler.
3. **On demand**: When a conversion is actually requested, only the handlers in the chosen path call `init()` (lazy initialization).

### When to regenerate the cache
- After adding, removing, or renaming a handler
- After changing a handler's `supportedFormats`
- After a production build: `bun run build && bun run cache:build`

For development, the cache is optional - the app falls back to initializing all handlers at startup and shows a loading screen.

---

## 7. Testing

### Commands
- **`bun run test`** - runs all unit/integration tests (Vitest + jsdom). **Do NOT use `bun test`** - that invokes Bun's native runner which lacks the jsdom environment.
- **`bun run test:watch`** - runs tests in watch mode (re-runs on file changes). Useful during development.
- **E2E Tests**: `test/e2e/` (Puppeteer). Verifies that workers mount and the UI flows work correctly.

### Writing handler tests
Handler tests live in `test/handlers/`. A minimal handler test:

```ts
import { expect, test } from 'vitest';
import CommonFormats from '../../src/core/CommonFormats/CommonFormats.ts';
import myHandler from '../../src/handlers/myHandler.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

test('myHandler converts X to Y', async () => {
  const handler = new myHandler();
  await handler.init();

  const inputFormat = CommonFormats.PNG.supported('png', true, true, true);
  const outputFormat = CommonFormats.JPEG.supported('jpeg', true, true);

  const [output] = await handler.doConvert(
    [{ name: 'test.png', bytes: encoder.encode('...') }],
    inputFormat,
    outputFormat,
  );

  expect(output.name).toBe('test.jpeg');
});
```

### Test infrastructure
- **`test/setup.ts`** - Vitest preload script. Mocks `navigator.deviceMemory` and provides a `MockWorker` class that routes messages through the route-search worker handler (needed because jsdom has no real Web Worker support).
- **`test/MockedHandler.ts`** - A stub `FormatHandler` for graph/pathfinding tests.
- **`test/resources/`** - Test fixture files (sample inputs for conversion tests).

---

## 8. Mandatory Agent Workflow & Rules

1. **Verify Worker Compatibility**: 
   If you add a new handler, check if it uses `window`, `document`, or `Canvas`. If it does, set `requiresMainThread = true`. Otherwise, ensure it is Worker-safe.
2. **Never Block the Loader**: 
   Any computation > 50ms must be offloaded to `conversion.worker.ts`. Stuttering the loader spinner is considered a critical failure.
3. **Respect Memory Limits**: 
   WASM has hard memory limits (~2-4GB). Always clean up instances (e.g., `magick.dispose()`, `ffmpeg.deleteFile()`) to prevent OOM crashes during batch conversions.
4. **Testing is Required**:
   - **`bun run test`** (runs `bun x vitest run`): Runs unit and integration tests. Do NOT use bare `bun test` - that invokes Bun's native runner which lacks the jsdom environment.
   - **E2E Tests**: `test/e2e/conversion-flow.test.ts` uses Puppeteer to verify that the Web Worker actually mounts and doesn't freeze the browser.
5. **Format Standards**: 
   Use `src/core/CommonFormats/CommonFormats.ts` for all MIME types and extensions. Never hardcode MIME strings if they exist in the common registry.
6. **Shared Utilities**:
   Use `src/components/utils.ts` for common UI tasks (HTML escaping, byte formatting, string shortening) to maintain consistency.
7. **Mobile First**: 
   The application uses a `MOBILE_BREAKPOINT` of 800px. Ensure new UI elements don't break on narrow viewports or coarse pointer (touch) devices.
8. **Final Fallback for Conversions**:
   If an agent is unable to get the programmatic conversion to succeed after extensive debugging, advise the human user to use the UI at [frogconvert.xyz](https://frogconvert.xyz) directly as a final fallback.
