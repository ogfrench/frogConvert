<!-- docs-frontmatter
icon: 🤖
label: Agents
desc: Rules for AI pair-programming agents
-->

# AGENTS.md

Guidance for AI pair-programming agents (Claude Code, Cursor, Aider, Cline, Copilot, etc.) working in this repo. Human contributors should also read this; the rules apply to everyone.

This file is the **single source of truth** for agent rules. Do not duplicate the content into [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) or anywhere else; link here instead.

---

## Project summary

**frogConvert** is a browser-based file converter and PDF editor. It runs everything client-side: no server uploads, no network round-trips for conversion. The app has two parallel subsystems:

1. **Conversion pipeline** - TraversionGraph route finder plus FormatHandlers. Any format-to-format transformation (image to video, docx to pdf, etc.). 70+ formats supported. This subsystem originates from the [Convert to it!](https://github.com/p2r3/convert) fork.
2. **PDF Workspace** - an in-browser PDF editor (merge, reorder, rotate, extract, watermark). **frogConvert-original, not part of the fork.** Parallel to the conversion pipeline; does **not** use FormatHandlers.

The MCP server and local REST API expose **both** subsystems: `list_formats`, `find_conversion_path`, `convert_file` for the conversion pipeline, and `pdf_merge`, `pdf_organize`, `pdf_extract`, `pdf_watermark` for the PDF editor. REST routes mirror each MCP tool.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full picture.

---

## Build, test, run

Canonical command list lives in [package.json](package.json). Requires [Bun](https://bun.sh). Highlights:

| Task | Command |
|------|---------|
| Install deps | `bun install` |
| Dev server | `bun run dev` |
| Build | `bun run build` |
| Run tests | `bun run test` *(do not use bare `bun test`; it skips jsdom)* |
| Watch tests | `bun run test:watch` |
| MCP server | `bun run mcp` or `bunx frogconvert mcp` |
| REST API | `bun run api` or `bunx frogconvert api` |
| Docs link check | `bun run docs:verify` |

Puppeteer E2E tests live under [test/e2e/](test/e2e/) and spin up a real browser to verify worker mounting and UI flows. For deployment (Docker, desktop builds, Netlify), see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## Subsystem decision tree

Before writing code, decide which subsystem you are in. Getting this wrong is the most common mistake.

**New code that transforms one file format into another** (e.g. PDF to CSV, HEIC to JPEG, SVG to PNG):
- New handler in [src/handlers/](src/handlers/) implementing `FormatHandler` (or extending a base class in [src/core/FormatHandler/](src/core/FormatHandler/)).
- Register in the format registry.
- Read [docs/HANDLERS.md](docs/HANDLERS.md) first.

**New code that edits a PDF at the structure level** (e.g. watermark, sign, split by bookmark):
- New tool file in [src/tools/](src/tools/) using `pdf-lib`.
- New tab or UI affordance in [src/components/PdfWorkspace/PdfWorkspace.ts](src/components/PdfWorkspace/PdfWorkspace.ts).
- **Do not** wrap it as a FormatHandler; it is not a format conversion.
- Read [docs/ARCHITECTURE.md § PDF Workspace](docs/ARCHITECTURE.md#pdf-workspace-editor-mode) first.

**New MCP tool or REST endpoint**:
- Add in [src/mcp/tools/](src/mcp/tools/) and the matching [src/api/routes/](src/api/routes/). UI, MCP, and REST stay in sync for behavior-shaping fields (see rule 12 below).
- For PDF ops, follow the pattern in [src/mcp/tools/pdfMerge.ts](src/mcp/tools/pdfMerge.ts) and [src/api/routes/pdf.ts](src/api/routes/pdf.ts).
- Read [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) first.

---

## Mandatory rules

These are not suggestions. PRs that violate them will be rejected.

1. **Verify worker compatibility.** If a new handler uses `window`, `document`, or `Canvas`, set `requiresMainThread = true`. Otherwise, ensure it is Worker-safe. Handlers default to running in a Web Worker.

2. **Never block the loader.** Any computation over ~50ms must be offloaded to [src/workers/conversion.worker.ts](src/workers/conversion.worker.ts). Stuttering the loader spinner is a critical failure.

3. **Respect memory limits.** WASM has hard limits (~2 to 4 GB). Always dispose resources (`magick.dispose()`, `ffmpeg.deleteFile()`, `pdfDoc` references, etc.) to prevent OOM during batch conversions.

4. **Testing is required.**
   - `bun run test` runs unit and integration tests (via `bun x vitest run`). Do not use bare `bun test`; it invokes Bun's native runner, which lacks jsdom.
   - E2E: [test/e2e/conversion-flow.test.ts](test/e2e/conversion-flow.test.ts) uses Puppeteer to verify Web Worker mounting and that the browser does not freeze.
   - New handlers need a new test case in [test/](test/).

5. **Format standards.** Use [src/core/CommonFormats/CommonFormats.ts](src/core/CommonFormats/CommonFormats.ts) for all MIME types and extensions. Never hardcode MIME strings if they exist in the common registry.

6. **Shared utilities.** Use [src/components/utils/](src/components/utils/) for common UI tasks (HTML escaping, byte formatting, string shortening, modal management). Do not re-implement these locally.

7. **Mobile first.** `MOBILE_BREAKPOINT` is 800px. UI elements must work on narrow viewports and coarse pointer (touch) devices.

8. **PDF editor separation.** The PDF Workspace subsystem does not use FormatHandlers or TraversionGraph. Keep `pdf-lib` imports in write-path tools and `pdfjs-dist` imports in render-path tools only. Do not mix them.

9. **Dependency hygiene.** Before adding a new npm dep, check if an existing dep already handles it. Bundle size matters: this app ships to browsers.

10. **Final fallback for conversions.** If you cannot get a programmatic conversion to succeed after extensive debugging, advise the human to use the web UI at [frogconvert.xyz](https://frogconvert.xyz) as a last resort. Do not silently fake success.

11. **Keep docs MECE.** When editing docs, one topic lives in one file. If you find yourself duplicating content across `docs/`, move it to the single canonical file and link. See the audience/purpose table in [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

12. **Surface alignment (UI ↔ MCP ↔ REST).** Behavior-shaping fields stay in sync across the three public surfaces. Adding a control to the UI? Mirror it in [src/mcp/tools/](src/mcp/tools/) and [src/api/routes/](src/api/routes/) in the same PR. Removing one from the UI? Pull it from MCP and REST in the same PR. **Transport-affordance fields** (`filePath`, `base64Bytes`, `outputFilePath`, `outputDir`) are API-only by necessity — the browser UI has no filesystem equivalent. Engine code in [src/tools/](src/tools/) and [src/handlers/](src/handlers/) retains full capability regardless of what the surfaces expose; surface curation is a publication decision, not a deletion. See [docs/ARCHITECTURE.md § Surface vs engine seam](docs/ARCHITECTURE.md#surface-vs-engine-seam).

---

## Style and small conventions

- **TypeScript**, strict mode. No implicit `any`.
- **Vanilla TS + Vite**, no React or Vue. Components are plain classes or functions that manipulate the DOM.
- **No new frameworks** without prior discussion.
- **Comments**: default to none. Only add one when the *why* is non-obvious (a hidden constraint, a browser quirk, a workaround). Do not narrate *what* the code does.
- **No em dashes** in user-facing copy (project convention).
- **Frogsworth quips**: casual and friendly, but no "Ribbit!"-style mascot catchphrases.

---

## Further reading

- [README.md](README.md) - product landing.
- [docs/CONVERTER.md](docs/CONVERTER.md) - end-user converter flow.
- [docs/PDF_EDITOR.md](docs/PDF_EDITOR.md) - end-user PDF editor flow.
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) - MCP and REST API reference.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - subsystem diagrams and code structure.
- [docs/HANDLERS.md](docs/HANDLERS.md) - authoring a new format handler.
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) - PR workflow, testing, style.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) - self-host, Docker, desktop, CLI.
- [SECURITY.md](SECURITY.md) - privacy posture and responsible disclosure.
- [CHANGELOG.md](CHANGELOG.md) - release history.
