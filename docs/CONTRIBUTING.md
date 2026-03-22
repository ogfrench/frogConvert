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
      // Example PNG format, with both input and output disabled
      CommonFormats.PNG.builder("png")
        .markLossless()
        .allowFrom(false)
        .allowTo(false),

      // Alternatively, if you need a custom format, define it like so:
      {
        name: "CompuServe Graphics Interchange Format (GIF)",
        format: "gif",
        extension: "gif",
        mime: "image/gif",
        from: false,
        to: false,
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

#### Important Implementation Rules:

- **Naming**: If your tool is called `dummy`, the class must be `dummyHandler` and the file `dummy.ts`.
- **Output Names**: The handler is responsible for setting the output file's name (usually just swapping the extension).
- **Immutability**: Byte buffers entering or exiting the handler must not be mutated. Clone them if necessary.
- **MIME Normalization**: Use `normalizeMimeType.ts` to ensure consistency.
- **Main Thread**: If the handler uses DOM APIs (Canvas, AudioContext), set `requiresMainThread: true`.
- **Initialization**: Keep `init()` lazy - do not load WASM blobs until it is called.

### Adding Dependencies

- **NPM**: Use `bun add`.
- **Git**: Add as a submodule to `src/handlers`.
- **CDNs**: Avoid them. They are unstable and don't play well with the offline-first/CLI nature of the project.
- **WASM**: Add paths to `vite.config.js` and target `/convert/wasm/`.

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

## 5. Testing

- **Unit Tests**: `bun run test` (Vitest + jsdom).
- **E2E Tests**: `test/e2e/` (Puppeteer). Verifies that workers mount and the UI flows work correctly.

---

## 6. Mandatory Agent Workflow & Rules

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
