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

The codebase is a vanilla TypeScript Vite project. Detailed responsibilities are in [ARCHITECTURE.md](ARCHITECTURE.md).

**Two parallel subsystems.** Before adding code, know which one you are touching:

- **Conversion pipeline** routes through TraversionGraph and FormatHandlers. Any format-to-format transformation lives here. This is the piece that originates from the [Convert to it!](https://github.com/p2r3/convert) fork; see the Credits section of [../README.md](../README.md).
- **PDF Workspace** (editor mode) is a separate, **frogConvert-original** subsystem in [../src/components/PdfWorkspace/](../src/components/PdfWorkspace/) plus tool files in [../src/tools/](../src/tools/). **Not part of the fork.** The handler authoring guide in [HANDLERS.md](HANDLERS.md) does not apply here. See [ARCHITECTURE.md § PDF Workspace](ARCHITECTURE.md#pdf-workspace-editor-mode).

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
- **Cancellation and partial downloads.** `isCancelled` and related state machine live in `src/conversion/cancellation.ts`. If a batch is cancelled, `showPartialDownloadPopup()` offers a download of finished files.
- **Scroll locking.** `updateScrollLock()` in `store.ts` checks all three modal elements for the `open` class and toggles `.scroll-lock` on `<html>`. Called automatically by `ModalManager`.

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
- After a production build: `bun run build && bun run cache:build`.

In dev, the cache is optional; the app falls back to initializing all handlers at startup with a loading screen.

---

## 5. Testing

### Commands

- **`bun run test`** runs unit and integration tests (Vitest + jsdom). **Do not use bare `bun test`**; that invokes Bun's native runner which lacks jsdom.
- **`bun run test:watch`** runs tests in watch mode.
- **E2E** tests live in `test/e2e/` (Puppeteer) and verify that workers mount and the UI flow works.

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
4. **Docs.** If you change a handler, update `public/cache.json` via `bun run cache:build`. If you change user-visible behaviour, touch the relevant doc ([CONVERTER.md](CONVERTER.md), [PDF_EDITOR.md](PDF_EDITOR.md), [INTEGRATIONS.md](INTEGRATIONS.md)) and add a [CHANGELOG.md](../CHANGELOG.md) bullet.
5. **Link-check.** `bun run docs:verify` catches broken cross-links before review.

---

## 7. Agent workflow

The full rules for AI pair-programming agents (Claude Code, Cursor, Aider, Cline, etc.) live in [../AGENTS.md](../AGENTS.md). That file is the single source of truth for agent behavior; this document covers the human contributor side only. The rules there apply equally to human contributors.

---

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md) - internal design and subsystem boundaries.
- [HANDLERS.md](HANDLERS.md) - authoring a new format handler.
- [../AGENTS.md](../AGENTS.md) - rules for AI agents and contributors.
- [INTEGRATIONS.md](INTEGRATIONS.md) - MCP and REST API reference.
