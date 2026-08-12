<!-- docs-frontmatter
icon: ⚙️
label: Contributing
desc: PR workflow, testing, style
-->

# Contributing to frogConvert

For developers extending or fixing frogConvert. Audience is humans; AI agents should read [../AGENTS.md](../AGENTS.md) instead (same rules, distilled).

This document covers **process**: how to structure PRs, test, and match the project's style.

For **authoring a new format handler**, see [HANDLERS.md](HANDLERS.md). For **system design**, see [ARCHITECTURE.md](ARCHITECTURE.md). For **MCP and REST**, see [INTEGRATIONS.md](INTEGRATIONS.md).

---

## Reporting bugs and giving feedback

Found a bug, want a new format added, or have feedback on the converter or PDF editor? Email **francois.prevot@frog.co**. Include:

- The input file format (and output format, for conversion bugs).
- The browser and OS you're on.
- A short description of what you expected vs. what happened.
- If possible, a sample file that reproduces the issue (do not send anything sensitive, frogConvert is fully client-side, but email isn't).

Same address for security reports. See [../SECURITY.md](../SECURITY.md).

---

## 1. Directory structure

The codebase is a vanilla TypeScript Vite project. Full responsibilities are in [ARCHITECTURE.md § Code Structure at a Glance](ARCHITECTURE.md#code-structure-at-a-glance). Day-to-day, these are the directories you will touch most:

- [src/handlers/](../src/handlers/) - one file per conversion tool (FFmpeg, ImageMagick, Pandoc, etc.). New format support lives here.
- [src/core/](../src/core/) - `FormatHandler` interface, base classes, `CommonFormats` registry, `TraversionGraph`, quality planners, and [src/core/compression/](../src/core/compression/) (the UI-free compression engine).
- [src/components/](../src/components/) - UI (vanilla TS + DOM), including `store/store.ts` for state, `PdfWorkspace/` for the PDF editor and `CompressWorkspace/` for the Compress surface.
- [src/tools/](../src/tools/) - PDF editor primitives (`pdfMerge.ts`, `pdfOrganize.ts`, `pdfExtract.ts`, `pdfWatermark.ts`, `pdfThumbnails.ts`).
- [src/mcp/](../src/mcp/) and [src/api/](../src/api/) - MCP server and REST API. Must stay in sync per [../AGENTS.md](../AGENTS.md).
- [src/workers/](../src/workers/) - `conversion.worker.ts` and `route-search.worker.ts`. Most heavy work runs here, not on the main thread.

**Three parallel subsystems.** Before adding code, know which one you are touching:

- **Conversion pipeline** routes through TraversionGraph and FormatHandlers. Any format-to-format transformation lives here. This is the piece that originates from the [Convert to it!](https://github.com/p2r3/convert) fork; see the Credits section of [../README.md](../README.md).
- **PDF Workspace** (editor mode) is a separate, **frogConvert-original** subsystem in [../src/components/PdfWorkspace/](../src/components/PdfWorkspace/) plus tool files in [../src/tools/](../src/tools/). **Not part of the fork.** The handler authoring guide in [HANDLERS.md](HANDLERS.md) does not apply here. See [ARCHITECTURE.md § PDF Workspace](ARCHITECTURE.md#pdf-workspace-editor-mode).
- **Compression engine** ([../src/core/compression/](../src/core/compression/) + [../src/components/CompressWorkspace/](../src/components/CompressWorkspace/)) makes a file smaller *without changing its format*. **frogConvert-original.** It borrows FormatHandlers as engines but does not use the conversion graph - dispatch happens in `resolveCompressor.ts`. The engine half is deliberately UI-free: it takes a `run` callback instead of importing the worker client, so `src/core/` never imports `src/components/`. Keep it that way. See [COMPRESS.md](COMPRESS.md).

---

## 2. UI and state management principles

frogConvert deliberately **does not use React or Vue**. Vanilla TS plus direct DOM for performance and small bundle size.

### State reactivity
State lives in `src/components/store/store.ts` as "Value Wrapper" objects:

```typescript
export const currentFiles: { value: File[] } = { value: [] };
```

UI components subscribe to or update `.value` manually.

### UI references
Avoid `document.querySelector` inside components. Use the centralized `ui` object in `store.ts` which caches all primary DOM references.

### Popups and modals
- **`Popup.ts`** exposes `showPopup(content, persistent?)`, `hidePopup()`, `showAlertPopup(title, html)`, `createPopupButton(text, class, onClick)`, and specialised helpers (`showSizeWarningPopup`, `showFileTypeMismatchPopup`). Open/close is delegated to `ModalManager`.
- **`utils/ModalManager.ts`** owns modal lifecycle: stacks open modals, toggles the `open` class, sets `aria-hidden`, handles keyboard escape (non-persistent modals), traps focus, and calls `updateScrollLock()`. Managed modals are `#format-modal`, `#files-modal`, `#popup`.
- **Visibility contract.** Modals are shown/hidden via the `open` CSS class, never `style.display`. A modal is open iff it has `classList.contains("open")`.
- **Spinners.** Active conversions use the gooey spinner (`loader-gooey`); short blocking operations like cancellation use `loader-spinner`.
- **Stopping and partial downloads.** `isCancelled` and related state machine live in `src/conversion/cancellation.ts`. If a batch is stopped, `showPartialDownloadPopup()` offers a download of finished files. User-facing copy says **stop / stopping / stopped** everywhere - the button, the interstitial, the finished state and the per-file row labels. The internal identifiers still say `cancel` (`isCancelled`, `cancelButton`, `reason: "cancelled"`); only the strings changed. Don't reintroduce "Cancel" in visible copy - it reads as *dismiss this dialog*, which is the opposite of abandoning work in flight.
- **Scroll locking.** `updateScrollLock()` in `store.ts` checks all five open-surface conditions - the format modal, the files modal, the top-bar menu, the popup, and the PDF workspace tray and toggles `.scroll-lock` on `<html>`. Called automatically by `ModalManager`.

---

## 3. Format mode system (Core / Plus / All)

The format picker exposes three tiers that filter which output formats are visible. Configured in `src/components/store/store.ts`:

- **Core** - common everyday formats. A format must be in the `CORE_FORMATS` whitelist **and** its category must not be in `CORE_HIDDEN_CATEGORIES` (hidden: `data`, `font`, `code`, `other`).
- **Plus** - adds data, font, and extra media formats. Uses `PLUS_FORMATS` (superset of `CORE_FORMATS`) and `PLUS_HIDDEN_CATEGORIES` (hidden: `code`, `other`).
- **All** - every registered format; no filtering.

If your new handler's formats do not appear in Core or Plus, add the format's short identifier (e.g. `"png"`, `"csv"`) to the relevant `Set` in `store.ts`. The selected mode persists in `localStorage`.

---

## 4. Cache system

frogConvert uses a pre-computed format cache (`public/cache.json`) to skip calling every handler's `init()` at startup. Without it, first page load is slow because each WASM handler must load to reveal its supported formats.

### How it works
1. **Build time.** `bun run cache:build` launches Puppeteer, loads the built site, waits for handlers to initialize, then calls `window.printSupportedFormatCache()` to serialize the handler→formats mapping.
2. **Runtime.** The app loads `cache.json` and builds the `TraversionGraph` immediately, no `init()` calls.
3. **On demand.** When a conversion is actually requested, only the handlers in the chosen path call `init()`.

### When to regenerate

- After adding, removing, or renaming a handler.
- After changing a handler's `supportedFormats`.

**Use `bun run cache:refresh`, not `cache:build`.** The two write to different
places and only one of them lasts:

| Script | Writes to | Survives? |
|---|---|---|
| `cache:refresh` | `public/cache.json` | **Yes** - this is the tracked file that ships |
| `cache:build` | `dist/cache.json` | No - `dist/` is gitignored, and the next build overwrites it with the copy from `public/` |

`cache:build` exists for `desktop:build`, which packages `dist/` directly and
never reads `public/`. Reaching for it to refresh the shipped cache is a no-op
that looks like it worked, which is how the committed cache silently fell three
handlers behind: through the whole v3 cycle it carried no `Ghostscript`,
`PdfCanvasCompress` or `imageToPdf` entries at all.

Both need a production build first, since they drive the built site:

```bash
bun run build && bun run cache:refresh
```

In dev, the cache is optional; the app falls back to initializing all handlers at startup with a loading screen.

---

## 5. Testing

### Commands

- **`bun run test`** runs unit and integration tests (Vitest + jsdom). **Do not use bare `bun test`**; that invokes Bun's native runner which lacks jsdom.
- **`bun run test:watch`** runs tests in watch mode.
- **E2E** tests live in `test/e2e/` (Puppeteer) and verify that workers mount and the UI flow works.

### The corpus suites (opt-in, and the ones that find real bugs)

Six suites in `test/e2e/` run real files through the real thing. Four drive the **built** app in a real browser - `corpus-compress`, `corpus-convert`, `corpus-pdf`, `corpus-combined` - and two drive the agent surfaces over their real transports: `corpus-api` (HTTP against a spawned `src/api/index.ts`) and `corpus-mcp` (stdio against `src/mcp/index.ts`). They exist because every serious defect in v3 lived in a seam between mocked units and was invisible to a green unit run - an encrypted PDF emptied and reported as an 83% saving, a truncated PDF returned as a blank page called a 99% win, a `.webm` not recognised as input at all.

They need ~49 MB of other people's files, so they are opt-in and skip loudly (`test/helpers/corpus.ts` prints a manifest of exactly what did not run and why - the inverse of `optionalDeps.ts`, which throws, because CI genuinely does have those dependencies and genuinely does not have this corpus):

```bash
bun run scripts/fetch-corpus.ts      # ~31 files from public repos
bun run scripts/make-adversarial.ts  # 12 generated edge cases
bun run build                        # they drive dist/, not the dev server
bun run test:corpus                  # sets FROG_CORPUS=1 for you
```

Deliberately **not** part of the default CI run: it needs a production build, a browser, and ~49 MB of downloads. `bun run test` skips all six suites, and says so. (The two agent suites need no build - they spawn the servers directly - but they share the same corpus gate.)

Shared plumbing lives in **two** helpers, split by what they drive. Add to the right one rather than starting a third copy.

`test/helpers/corpusBrowser.ts` - static server, browser, downloads, and re-opening PDF output with pdf-lib and pdfjs. Two things it encodes that cost a debugging round each: `.mjs` must be in the server's MIME map (Ghostscript ships `gs.mjs`, and a module script with the wrong type is refused, which looks exactly like a compression failure), and every suite waits for the handler registry rather than a fixed delay.

`test/helpers/corpusAgents.ts` - spawning the API and MCP servers, and the byte-level assertions both agent suites share. It encodes three constraints of its own:

- **`PORT=0`, always.** The API defaults to 3000 and vitest runs test files in parallel workers, so a fixed port fails as an unexplained connection refusal *inside a child process* rather than as the port conflict it is. The assigned port is read back off the line the server prints, because that is the only place it exists.
- **SIGTERM, never SIGKILL.** `browserBridge.ts` installs a SIGTERM handler whose exit path kills the Chromium it warmed up. SIGKILL leaks a browser per run.
- **Compare by size, page count and extracted text - not by bytes.** Ghostscript stamps an XMP `ModifyDate`, so the same file compressed twice a second apart already differs. A first version of the REST-vs-MCP parity test asserted byte equality and reported the app broken for it.

The two agent suites also check the surfaces against *each other*: both are thin wrappers over `compressForAgents`, and each was previously only ever compared against itself, so one drifting to different options would have gone unnoticed.

### Writing a handler test

Handler tests are **colocated** with the handler under `src/handlers/` (e.g. `src/handlers/myHandler.test.ts`). `test/` is reserved for e2e, fixtures, and shared mocks. Minimal:

```ts
import { expect, test } from 'vitest';
import CommonFormats from '../core/CommonFormats/CommonFormats.ts';
import myHandler from './myHandler.ts';

const encoder = new TextEncoder();

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

- **`test/setup.ts`** - Vitest preload. Mocks `navigator.deviceMemory` and provides `MockWorker` that routes messages through the route-search worker handler (jsdom has no real Web Worker support).
- **`test/MockedHandler.ts`** - stub `FormatHandler` for graph/pathfinding tests.
- **`test/resources/`** - fixture files.

---

## 6. PR workflow

1. **Fork and branch.** One topic per branch. Branch names are descriptive (`add-webp-handler`, `fix-safari-pdf-fallback`).
2. **Commit style.** Imperative, specific. Don't bundle unrelated changes.
3. **Run locally.** `bun run test` must be green. Run `bun run build` once before opening the PR.
4. **Docs.** If you change a handler, update `public/cache.json` via `bun run build && bun run cache:refresh` (see [Cache system](#4-cache-system) for why `cache:build` is the wrong one). If you change user-visible behaviour, touch the relevant doc ([CONVERTER.md](CONVERTER.md), [PDF_EDITOR.md](PDF_EDITOR.md), [INTEGRATIONS.md](INTEGRATIONS.md)) and add a [CHANGELOG.md](../CHANGELOG.md) bullet.
5. **Doc sync.** `bun run docs:verify` checks that any root-level `.md` with a twin in `docs/` has identical contents. It does *not* check links, and it passes trivially when no such pair exists - so treat a green as "no duplicate has drifted", not as "the docs are fine".
6. **Declare what you import.** A package that happens to be installed as somebody else's transitive dependency will import fine on your machine and keep working until that somebody bumps a version and drops it. If you `import` it, it belongs in `package.json`, and both `package.json` and `bun.lock` go in the commit - CI runs `bun i --frozen-lockfile` and fails if they disagree.
7. **Dead-file check.** `bun x knip --include files,unlisted` is **enforced in CI**: a file nothing imports fails the build. Run the full `bun x knip` too - the other categories are advisory but real. If it flags a file that *is* used, the reference is probably invisible to it (a path inside a string, say), and the fix is to declare it in `knip.jsonc` as an entry rather than to ignore the finding. Read the warning at the top of that file before removing any ignore.

---

## 7. Agent workflow

The full rules for AI pair-programming agents (Claude Code, Cursor, Aider, Cline, etc.) live in [../AGENTS.md](../AGENTS.md). That file is the single source of truth for agent behavior; this document covers the human contributor side only. The rules there apply equally to human contributors.

---

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md) - internal design and subsystem boundaries.
- [HANDLERS.md](HANDLERS.md) - authoring a new format handler.
- [../AGENTS.md](../AGENTS.md) - rules for AI agents and contributors.
- [INTEGRATIONS.md](INTEGRATIONS.md) - MCP and REST API reference.
