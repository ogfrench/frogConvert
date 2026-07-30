<!-- docs-frontmatter
icon: 🧩
label: Handlers
desc: Authoring a new format handler
-->

# Handlers: Authoring Guide

How to add a new format conversion to frogConvert. If you are editing the PDF editor (merge, reorder, extract, watermark), you are in the wrong guide; see [ARCHITECTURE.md § PDF Workspace](ARCHITECTURE.md#pdf-workspace-editor-mode).

For conversion-pipeline internals (TraversionGraph, cost model), see [ARCHITECTURE.md](ARCHITECTURE.md). For contribution process (PR flow, testing, style), see [CONTRIBUTING.md](CONTRIBUTING.md). For the rules every contributor and agent must follow, see [../AGENTS.md](../AGENTS.md).

---

## The `FormatHandler` Interface

Every handler conforms to the `FormatHandler` interface in `src/core/FormatHandler/FormatHandler.ts`:

```typescript
export interface FormatHandler {
    name: string;
    supportedFormats?: FileFormat[]; // from/to compatibility
    supportAnyInput?: boolean;       // last-resort fallback handlers
    ready: boolean;                  // init completion flag
    requiresMainThread?: boolean;    // CRITICAL FLAG
    init: () => Promise<void>;       // fetch assets, load WASM, set up contexts
    doConvert: (
        inputFiles: FileData[],
        inputFormat: FileFormat,
        outputFormat: FileFormat,
        args?: string[],
        onProgress?: (p: ProgressEvent) => void,
    ) => Promise<FileData[]>;
}
```

## Base Classes (prefer these over raw `FormatHandler`)

Two abstract base classes live in `src/core/FormatHandler/`:

- **`BaseHandler`** - implements `ready = true`, an `init()` that sets `ready = true`, and a `replaceExtension(filename, ext)` helper. Use for handlers that don't need async init; `supportedFormats` must be defined at class level. **Do not use for WASM handlers** - those implement `FormatHandler` directly, start with `ready = false`, and set `supportedFormats` inside `init()`.
- **`TextFormatHandler extends BaseHandler`** - handles the `Uint8Array → string → Uint8Array` pipeline. Instead of `doConvert()`, implement `doConvertText(inputTexts, inputFormat, outputFormat)` which receives `{ name: string, text: string }[]`. Use for JSON, CSV, XML, YAML, source code, and any text-based format.

## The `requiresMainThread` rule

Governs whether a handler blocks the UI.

- **`false` or `undefined` (preferred).** Handler runs inside `src/workers/conversion.worker.ts`. Takes `Uint8Array` in, returns `Uint8Array` out. Mandatory for heavy WASM (FFmpeg, ImageMagick).
- **`true`.** Handler needs DOM-exclusive APIs (`HTMLCanvasElement`, `XMLSerializer`, `AudioContext`, `WebGL`). Must run on the main thread.
  - *Examples:* `canvasToBlob.ts` (image encoding), `svgTrace.ts`, `sppd.ts` (3D context), `meyda.ts` (audio analysis).

## Adding a new handler

Each tool used for conversion is normalized to a standard "wrapper" in [src/handlers](../src/handlers/). Barebones skeleton (raw `FormatHandler` with WASM/async-init pattern; for simple non-WASM handlers, extend `BaseHandler` instead):

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
      CommonFormats.PNG.builder("png")
        .markLossless()
        .allowFrom(true)
        .allowTo(true),
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
    outputFormat: FileFormat,
    args?: string[],
    onProgress?: (p: ProgressEvent) => void,
  ): Promise<FileData[]> {
    const outputFiles: FileData[] = [];
    return outputFiles;
  }
}

export default dummyHandler;
```

### Quality presets

Handlers that re-encode should parse the `--quality` flag from `args`. `extractQualityPreset(args)` returns `"low" | "medium" | "high" | "lossless"` or `undefined`. The web UI, MCP `convert_file` tool, and REST `POST /convert` all pipe this through; `undefined` means the caller didn't specify and the handler should use `"medium"` as the default.

Don't hand-roll your own quality mapping. Route through the shared planner in `src/core/compression/plan.ts`:

- `planVideo(inputBytes, preset)` for video output
- `planGif(inputBytes, preset)` for GIF output
- `planAudio(outputLossless, channels, preset)` for audio output
- `planImage({ pixelCount, preset, outputLossless, archetype })` for image output

**Image archetype** matters: the same image-output handler can be converting one hand-picked photo (`archetype: "singleton"`) or one of hundreds of frames extracted from a video (`archetype: "video-frame"`). Passing the right archetype keeps quality sensible for both cases. See `ImageArchetype` in `plan.ts` for the full list.

**Same-format compression.** Conversion routes can include same-format requests (e.g. `JPG → JPG`). In these cases, the handler is called to re-encode the file using the specified `quality` preset (defaults to `"medium"`). Output files from these runs are subject to a **smart size-guard** in the conversion runner: if the result is larger than the original, it is discarded.

The same handlers back the dedicated **Compress** surface, which dispatches through `src/core/compression/resolveCompressor.ts` rather than the conversion graph. Two consequences for handler authors:

- **A handler becomes a compressor for free** once its format is whitelisted in `resolveCompressor.ts` — no separate code path. Compression calls `doConvert` with matching input and output formats.
- **Note the inverted preset semantics.** `low` is the lowest quality *target*, so it compresses the hardest; `high` compresses least. Getting this backwards silently turns "Smallest file" into "barely touched". It is worth a test.

Compression also applies a 98% keep-threshold (a result must save at least 2% to be used) and skips inputs under 512 bytes, which are all container overhead. Both live in `compressBatch.ts`, not in handlers — do not reimplement them. See [COMPRESS.md](COMPRESS.md).

PDF render knobs (DPI and megapixel caps) live in `src/core/FormatHandler/qualityPresets.ts` as `PRESETS[preset].pdfDpi` / `pdfMp` / `pngCnum`, consumed by `pdftoimg`.

### Progress reporting

After 10 seconds the UI shows a live "Working on it..." notice with elapsed time and a rotating reassurance line. Handlers that have an internal counter (page loop, frame loop, image loop) should call `onProgress?.({ detail: "..." })` once per iteration so the notice can surface a concrete fact like `Page 12 of 50`, `Encoded 3.2s of 8.7s`, or `Image 4 of 18`. Keep the string under ~40 characters; it's rendered verbatim. Handlers with nothing meaningful to say should simply not emit, the elapsed line alone is fine.

```ts
for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
  onProgress?.({ detail: `Page ${pageNum} of ${pdf.numPages}` });
  // ...do slow work for this page...
}
```

`ratio` (0..1) is also supported for progress-bar style signals. FFmpeg emits both; the slow-conversion notice falls back to a `"N% done"` line when a handler emits ratio without detail.

### Multi-file output

Some conversions produce multiple outputs (frame extraction from animated GIF, video to PNG sequence, multi-size ICO bundles). Return every file from `doConvert()` as a separate `FileData` entry. When there are multiple outputs, name them with an index suffix (`frame_1.png`, `frame_2.png`). The UI automatically zips multi-file results for download.

### Post-conversion notices

If a handler auto-adapts to fit a ceiling (e.g. PDF shrunk to stay under the memory cap, video-to-GIF trimmed to a duration cap, video frames sampled adaptively, sample rate snapped to a codec's whitelist), report it with a structured notice. Import the helper:

```ts
import { attachNotice, API_DOCS_ACTION, fmtDuration } from "../core/compression/notices.ts";

attachNotice(outputFile, {
  title: "Trimmed to the first 60 seconds",
  body: `GIF gets unwieldy past a minute of video (this source ran ${fmtDuration(probedDuration)}). To pick a different section, trim the source first, or use the API with -ss and -t.`,
  action: API_DOCS_ACTION,
});
```

Each notice becomes one `.convert-notice` card in the success popup (reuses the same component as the "better handler available" hint). `attachNotice` also mirrors the body into `FileData.warnings` so MCP / REST JSON consumers that read `warnings` still see it.

**Copy rules**:
- No em dashes. Use periods, commas, colons, or rephrase.
- Specific numbers, not generic templates. "Sampled 300 frames" beats "Sampled some frames."
- Name the real escape route. If there isn't one in the web UI, point at the API docs via `API_DOCS_ACTION`.
- Informational tone, not apologetic.

**Never throw "try lower quality" errors.** The web UI has no quality selector; those messages are dead ends. Adapt instead, then attach a notice explaining what was adjusted.

### Implementation rules

- **Naming.** Tool named `dummy` means class `dummyHandler` in file `dummy.ts`.
- **Output names.** The handler sets the output file's name (usually by swapping the extension).
- **Immutability.** Byte buffers in or out must not be mutated. Clone if needed.
- **MIME normalization.** Use `normalizeMimeType.ts`.
- **Main thread.** DOM APIs mean `requiresMainThread: true`.
- **Lazy init.** Do not load WASM blobs until `init()` is called.

## Builder API

`FormatDefinition.builder(ref)` returns a chainable builder for `FileFormat` objects. Every method returns `this`.

| Method | Description |
|---|---|
| `.allowFrom(value?)` | Enable/disable conversion **from** this format. Default: `true`. |
| `.allowTo(value?)` | Enable/disable conversion **to** this format. Default: `true`. |
| `.markLossless(value?)` | Mark the format as lossless in this handler's context. Default: `true`. |
| `.named(name)` | Override the display name. |
| `.withFormat(format)` | Override the short format identifier. |
| `.withExt(ext)` | Override the file extension. |
| `.withMime(mime)` | Override the MIME type. |
| `.withCategory(category)` | Replace the category (string or string array). |
| `.override(values)` | Bulk override any `IFormatDefinition` fields. |

Example, reusing a CommonFormats entry but overriding the display name:

```ts
CommonFormats.PNG.builder("png-hd")
  .named("PNG (High-Density)")
  .allowFrom(true)
  .allowTo(true)
  .markLossless()
```

## Registering your handler

After creating your handler in `src/handlers/`, register it in `src/handlers/index.ts`. Two patterns:

**Dynamic import (preferred)** - loaded asynchronously after the page starts, keeps the initial bundle small:

```ts
// in the loaders array inside loadBackgroundHandlers()
async () => { const m = await import("./myHandler.ts"); handlers.push(new m.default()); },
```

**Static import (core handlers only)** - for handlers that must be available at startup (`canvasToBlob`, `jszip`), bundled into the main chunk:

```ts
import myHandler from "./myHandler.ts";
// ...
try { handlers.push(new myHandler()) } catch (e) { console.warn('[handlers] Failed to load myHandler:', e); }
```

Use dynamic import unless your handler is needed for the initial format graph or is a dependency of other core components. If your file exports multiple handlers (like `midi.ts` or `rename.ts`), push them all in a single loader:

```ts
async () => { const m = await import("./midi.ts"); handlers.push(new m.midiCodecHandler(), new m.midiSynthHandler()); },
```

## Adding dependencies

- **npm.** Use `bun add`.
- **Git.** Add as a submodule under `src/handlers`.
- **CDNs.** Avoid. They are unstable and break the offline-first / CLI story.
- **WASM.** Add paths to `vite.config.js`, target `/wasm/`.

## The Traversion Graph (what your handler plugs into)

frogConvert does not hardcode "PNG to MP4 goes through FFmpeg". Handlers declare what they take and output via `FileFormat` objects, and the `TraversionGraph` finds a path for every requested conversion by running Dijkstra in `src/workers/route-search.worker.ts`.

1. Builds nodes for every registered `FileFormat`.
2. Builds directed edges where a `FormatHandler` implements the path.
3. **Edge costs and heuristics**:
   - **Base cost.** Simple conversions are cheap.
   - **Init cost.** Handlers like FFmpeg add a high "boot" cost on the first edge.
   - **Category change penalty.** Stepping between categories costs more (Image to Video is nearly free at 0.2; Image to Audio is expensive at ~1.4). Certain three-step sequences (audio to video to image) receive an adaptive 10,000 penalty to prevent absurd multi-hop paths.
   - **Lossy penalty.** Converting to a lossy format adds cost.

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md) - system design and subsystem boundaries.
- [CONTRIBUTING.md](CONTRIBUTING.md) - PR process, testing, style.
- [../AGENTS.md](../AGENTS.md) - mandatory rules for contributors and AI agents.
