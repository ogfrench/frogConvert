<!-- docs-frontmatter
icon: 📖
label: frogConvert
desc: What is it & how to use
-->

# [frogConvert](https://frogconvert.xyz)
_(Backup domain: [frogconvert.netlify.app](https://frogconvert.netlify.app/)) · [GitHub](https://github.com/ogfrench/frogConvert)_

**Truly universal online file converter.**

_This project is a fork of "[Convert to it!](https://p2r3.github.io/convert/)" (original repo [here](https://github.com/p2r3/convert)). **All credit for the core file conversion engine and logic goes to the original developer.** This fork is a reimagining of the UI/UX with quality-of-life improvements._

## What's New in frogConvert
Compared to the original `Convert to it!`, frogConvert focuses on frontend improvements, performance, and agentic compatibility:
- **Redesigned Modern UI/UX:** A completely fresh, visually appealing look with dedicated modules, light/dark theme toggles, and a refined file format selection interface.
- **Enhanced Mobile Experience:** Fully responsive layout with a hamburger menu, fixed file name overflowing, and optimized padding and alignments for smaller screens.
- **File Management & Uploads:** Introduced a new file management feature and set limits on maximum file uploads to prevent crashes and improve stability.
- **Format Mode (Core / Plus / All):** Three-tier filter for the format picker - Core shows common everyday formats, Plus adds data, font, and extra media formats, All shows every supported format.
- **Partial Download support:** If you cancel a large batch conversion, frogConvert now offers to download the files that have already finished processing.
- **MCP + REST API for AI Agents:** Built-in MCP server and local HTTP REST API exposing the full conversion engine to AI agents and scripts - all processing is local, no external network calls. Run without cloning: `bunx frogconvert mcp` / `bunx frogconvert api`. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) for full usage.
- **Web Worker Performance:** Heavy conversion tasks and pathfinding run in background Web Workers, keeping the UI fully responsive even during complex, multi-step conversions.
- **Robust Engineering Foundation:** Refactored the codebase with centralized modal management, base handler classes, and a full vitest + Puppeteer E2E test suite.
- **Frogsworth:** A desktop mascot in the bottom-right corner. Click the frog for context-aware quips about your chosen file formats.

## What is it?
> _This section is adapted from the [original README](https://github.com/p2r3/convert#readme)._

Many online file conversion tools are **boring** and **insecure**. They only allow conversion between two formats in the same medium (images to images, videos to videos, etc.), and they require that you _upload your files to some server_.

This is not just terrible for privacy, it's also incredibly lame. What if you _really_ need to convert an AVI video to a PDF document? Try to find an online tool for that, I dare you.

[frogConvert](https://frogconvert.xyz) runs entirely in your browser. You're almost _guaranteed_ to get an output - perhaps not always the one you expected, but it'll try its best to not leave you hanging.

For a semi-technical overview of the original tool, check out this video: https://youtu.be/btUbcsTbVA8

## How to Use

### Converting a File

1. **Upload your file** - Drag and drop a file onto the upload zone, or click it to browse. You can upload multiple files at once (up to the device limit).
2. **Auto-detection** - frogConvert automatically detects your file's format and selects the matching input type. The category tab (Image, Audio, Video, etc.) switches to match.
3. **Pick an output format** - Click the format selector button to open the format picker. Browse by category tabs, or use the search bar to find a specific format. Click a format to select it.
4. **Convert** - Hit the **Convert** button. A progress indicator shows how many files have been processed.
5. **Download** - Once conversion finishes, your converted file downloads automatically.

### Tips

- **Any-to-any** - frogConvert can chain multiple conversion tools together to reach formats that no single tool supports directly. Want to turn a WAV into a PDF? Go for it.
- **Privacy first** - Everything runs in your browser. No files are ever uploaded to a server.
- **Theme toggle** - Switch between light and dark mode with the theme button in the top bar.
- **Mode toggle** - Switch between **Core**, **Plus**, and **All** mode to control how many output formats are shown. Core shows the most common formats; Plus adds data, font, and more; All shows everything.
- **Multiple files** - When you upload more than one file, use the file manager to review, add, remove, or replace individual files.
- **Partial Downloads** - Cancelled a batch mid-way? No problem. You can still download the files that were successfully converted before you hit cancel.
- **Performance** - frogConvert detects your device's available RAM and adjusts limits to prevent crashes on lower-end hardware.

### Known Limitations

- **PDF conversion on Safari** - Due to restrictions in Safari's JavaScript engine, PDF input (e.g. PDF → PNG, PDF → TXT) is not supported on Safari. Use Chrome or Firefox for PDF conversions. All other formats work normally on Safari.

## Deployment
> _The deployment steps below are adapted from the [original README](https://github.com/p2r3/convert#readme), updated for this fork's repository URL._

### MCP Server / REST API - No Repo Clone Required

The MCP server and REST API can be run directly via `bunx` - no clone or install needed. Requires [Bun](https://bun.sh/).

**MCP server** (add to `~/.claude.json` or `claude_desktop_config.json`):
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

**REST API (recommended for scripting and automation):**
```bash
bunx frogconvert api
# PORT=8080 bunx frogconvert api
```

> **Recommended for most programmatic use cases.** The REST API requires no approval prompts, works with any HTTP client (`curl`, `fetch`, scripts), and is faster to iterate with than the MCP server. Use MCP only when you want Claude to drive conversions autonomously within a Claude Code / Claude Desktop session.

See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) for full API documentation and tool reference.

> **First-run note:** The npm package bundles `pandoc.wasm` (~55 MB uncompressed, ~12 MB compressed download) for document conversion. `bunx` caches this after the first run.

### Local development (Bun + Vite)

1. Clone this repository ***WITH SUBMODULES***. You can use `git clone --recursive https://github.com/ogfrench/frogConvert` for that. Omitting submodules will leave you missing a few dependencies.
2. Install [Bun](https://bun.sh/).
3. Run `bun install` to install dependencies.
4. Run `bun run dev` to start the development server.

_The following steps are optional, but recommended for performance:_

When you first open the page, it'll take a while to generate the list of supported formats for each tool. If you open the console, you'll see it complaining a bunch about missing caches.

After this is done (indicated by a `Built initial format list` message in the console), use `printSupportedFormatCache()` to get a JSON string with the cache data. You can then save this string to `public/cache.json` to skip that loading screen on startup.

### Docker (prebuilt image)

Docker compose files live in the `docker/` directory, so run compose with `-f` from the repository root:

```bash
docker compose -f docker/docker-compose.yml up -d
```

Alternatively download the `docker-compose.yml` separately and start it by executing `docker compose up -d` in the same directory.

This runs the container on `http://localhost:8080/`.

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
> - **Testing**: The original has no automated tests. frogConvert adds a full vitest unit test suite (jsdom) and Puppeteer E2E tests in `test/e2e/`.
> - **MCP server + REST API**: Entirely new in frogConvert - see `docs/INTEGRATIONS.md` for full usage documentation.
- **Everything else** (handler pattern, `doConvert`, `FileFormat`, `CommonFormats`, graph algorithm) is structurally identical to the original.

The best way to contribute is by adding support for new file formats or improving the UI. 

For architecture details, handler authoring rules, and the full file structure, see **[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)**.
