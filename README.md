# [frogConvert!](https://frogconvert.xyz)
_(Backup domain: [frogconvert.netlify.app](https://frogconvert.netlify.app/)) · [GitHub](https://github.com/ogfrench/frogConvert)_

**Truly universal online file converter.**

_This project is a fork of "[Convert to it!](https://p2r3.github.io/convert/)" (original repo [here](https://github.com/p2r3/convert)). **All credit for the core file conversion engine and logic goes to the original developer.** This fork is a reimagining of the UI/UX with quality-of-life improvements._

## 🌟 What's New in frogConvert
Compared to the original `Convert to it!`, frogConvert focuses on frontend improvements, performance, and agentic compatibility:
- **Redesigned Modern UI/UX:** A completely fresh, visually appealing look with dedicated modules, light/dark theme toggles, and a refined file format selection interface.
- **Enhanced Mobile Experience:** Fully responsive layout with a hamburger menu, fixed file name overflowing, and optimized padding and alignments for smaller screens.
- **File Management & Uploads:** Introduced a new file management feature and set limits on maximum file uploads to prevent crashes and improve stability.
- **Format Mode (Core / Plus / All):** Three-tier filter for the format picker — Core shows common everyday formats, Plus adds data, font, and extra media formats, All shows every supported format.
- **Partial Download support:** If you cancel a large batch conversion, frogConvert now offers to download the files that have already finished processing.
- **MCP + REST API for AI Agents:** Built-in MCP server (`bun run mcp`) and local HTTP REST API (`bun run api`) exposing the full conversion engine to AI agents and scripts — all processing is local, no external network calls. See `AGENTS.md` for usage.
- **Web Worker Performance:** Heavy conversion tasks and pathfinding run in background Web Workers, keeping the UI fully responsive even during complex, multi-step conversions.
- **Robust Engineering Foundation:** Refactored the codebase with centralized modal management, base handler classes, and a full vitest + Puppeteer E2E test suite.
- **Frogsworth:** A desktop Easter egg mascot in the bottom-right corner. Click the frog for context-aware quips about your chosen file formats. Lazy-loaded at idle priority — zero impact on startup performance.

## What is it?
> _This section is adapted from the [original README](https://github.com/p2r3/convert#readme)._

Many online file conversion tools are **boring** and **insecure**. They only allow conversion between two formats in the same medium (images to images, videos to videos, etc.), and they require that you _upload your files to some server_.

This is not just terrible for privacy, it's also incredibly lame. What if you _really_ need to convert an AVI video to a PDF document? Try to find an online tool for that, I dare you.

[frogConvert](https://frogconvert.xyz) runs entirely in your browser. You're almost _guaranteed_ to get an output - perhaps not always the one you expected, but it'll try its best to not leave you hanging.

For a semi-technical overview of the original tool, check out this video: https://youtu.be/btUbcsTbVA8

## How to Use

### Converting a File

1. **Upload your file** — Drag and drop a file onto the upload zone, or click it to browse. You can upload multiple files at once (up to the device limit).
2. **Auto-detection** — frogConvert automatically detects your file's format and selects the matching input type. The category tab (Image, Audio, Video, etc.) switches to match.
3. **Pick an output format** — Click the format selector button to open the format picker. Browse by category tabs, or use the search bar to find a specific format. Click a format to select it.
4. **Convert** — Hit the **Convert** button. A progress indicator shows how many files have been processed.
5. **Download** — Once conversion finishes, your converted file downloads automatically.

### Tips

- **Any-to-any** — frogConvert can chain multiple conversion tools together to reach formats that no single tool supports directly. Want to turn a WAV into a PDF? Go for it.
- **Privacy first** — Everything runs in your browser. No files are ever uploaded to a server.
- **Theme toggle** — Switch between light and dark mode with the theme button in the top bar.
- **Mode toggle** — Switch between **Core**, **Plus**, and **All** mode to control how many output formats are shown. Core shows the most common formats; Plus adds data, font, and more; All shows everything.
- **Multiple files** — When you upload more than one file, use the file manager to review, add, remove, or replace individual files.
- **Partial Downloads** — Cancelled a batch mid-way? No problem. You can still download the files that were successfully converted before you hit cancel.
- **Performance** — frogConvert detects your device's available RAM and adjusts limits to prevent crashes on lower-end hardware.

## Deployment
> _The deployment steps below are adapted from the [original README](https://github.com/p2r3/convert#readme), updated for this fork's repository URL._

### Local development (Bun + Vite)

1. Clone this repository ***WITH SUBMODULES***. You can use `git clone --recursive https://github.com/ogfrench/frogConvert` for that. Omitting submodules will leave you missing a few dependencies.
2. Install [Bun](https://bun.sh/).
3. Run `bun install` to install dependencies.
4. Run `bun run dev` to start the development server.

_The following steps are optional, but recommended for performance:_

When you first open the page, it'll take a while to generate the list of supported formats for each tool. If you open the console, you'll see it complaining a bunch about missing caches.

After this is done (indicated by a `Built initial format list` message in the console), use `printSupportedFormatCache()` to get a JSON string with the cache data. You can then save this string to `cache.json` to skip that loading screen on startup.

### Docker (prebuilt image)

Docker compose files live in the `docker/` directory, so run compose with `-f` from the repository root:

```bash
docker compose -f docker/docker-compose.yml up -d
```

Alternatively download the `docker-compose.yml` separately and start it by executing `docker compose up -d` in the same directory.

This runs the container on `http://localhost:8080/convert/`.

### Docker (local build for development)

Use the override file to build the image locally:

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.override.yml up --build -d
```

The first Docker build is expected to be slow because Chromium and related system packages are installed in the build stage (needed for puppeteer in `scripts/buildCache.js`). Later builds are usually much faster due to Docker layer caching.

## Contributing
> _The contributing guidelines below are adapted from the [original README](https://github.com/p2r3/convert#readme)._

> **What changed from the original project:**
> - **Build system**: The original uses `npm`/`tsx`; frogConvert uses [Bun](https://bun.sh/) exclusively (`bun install`, `bun run dev`, `bun run test`).
> - **Handler interface**: The `FormatHandler` interface is extended with an optional `requiresMainThread` flag that controls whether a handler runs in a Web Worker or on the main thread. See details below.
> - **Testing**: The original has no automated tests. frogConvert adds a full vitest unit test suite (jsdom) and Puppeteer E2E tests in `test/e2e/`.
> - **MCP server + REST API**: Entirely new in frogConvert — see `AGENTS.md` for full usage documentation.
> - **Everything else** (handler pattern, `doConvert`, `FileFormat`, `CommonFormats`, graph algorithm) is structurally identical to the original.

The best way to contribute is by adding support for new file formats (duh). Here's how that works:

### Creating a handler

Each "tool" used for conversion has to be normalized to a standard form - effectively a "wrapper" that abstracts away the internal processes. These wrappers are available in [src/handlers](src/handlers/).

Two abstract base classes make handler authoring easier:

- **`BaseHandler`** (`src/core/FormatHandler/BaseHandler.ts`) — provides `ready = true`, a no-op `init()`, and a `replaceExtension(filename, ext)` helper. Extend this for binary/WASM handlers.
- **`TextFormatHandler`** (`src/core/FormatHandler/TextFormatHandler.ts`) — extends `BaseHandler` and handles the `Uint8Array ↔ string` decode/encode pipeline automatically. Implement `doConvertText()` instead of `doConvert()`. Use this for JSON, CSV, XML, YAML, source code, etc.

Below is a super barebones handler that does absolutely nothing. You can use this as a starting point for adding a new format:

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

For more details on how all of these components work, refer to the doc comments in [src/core/FormatHandler/FormatHandler.ts](src/core/FormatHandler/FormatHandler.ts). You can also take a look at existing handlers to get a more practical example.

There are a few additional things that I want to point out in particular:

- Pay attention to the naming system. If your tool is called `dummy`, then the class should be called `dummyHandler`, and the file should be called `dummy.ts`.
- The handler is responsible for setting the output file's name. This is done to allow for flexibility in rare cases where the _full_ file name matters. Of course, in most cases, you'll only have to swap the file extension.
- The handler is also responsible for ensuring that any byte buffers that enter or exit the handler _do not get mutated_. If necessary, clone the buffer by wrapping it in `new Uint8Array()`.
- When handling MIME types, run them through [normalizeMimeType](src/core/utils/normalizeMimeType.ts) first. One file can have multiple valid MIME types, which isn't great when you're trying to match them algorithmically.
- If your handler does not require DOM APIs (`Canvas`, `document`, `AudioContext`, `WebGL`), leave `requiresMainThread` unset (or set it to `false`). If it does, set `public requiresMainThread = true` so the conversion engine knows to keep it on the main thread instead of running it in a Web Worker.
- When implementing a new file format, please treat the file as the media that it represents, not the data that it contains. For example, if you were making an SVG handler, you should treat the file as an _image_, not as XML.

### Adding dependencies

If your tool requires an external dependency (which it likely does), there are currently two well-established ways of going about this:

- If it's a package from a registry, just install it using `bun add` like you normally would.
- If it's a Git repository, add it as a submodule to [src/handlers](src/handlers).

**Please try to avoid CDNs (Content Delivery Networks).** They're really cool on paper, but they don't work well with TypeScript, and each one introduces a tiny bit of instability. For a project that leans heavily on external dependencies, those bits of instability can add up fast.

- If you need to load a WebAssembly binary (or similar), add its path to [vite.config.js](vite.config.js) and target it under `/convert/wasm/`. **Do not link to node_modules**.
