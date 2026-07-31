<!-- docs-frontmatter
icon: 🧭
label: Adding a mode
desc: The checklist for shipping a new top-level surface, distilled from building Compress
-->

# Adding a mode

frogConvert has three top-level modes: Converter, PDF Editor, Compress. This is the playbook for adding a fourth, written down while building Compress (v3.0.0) so the next surface doesn't rediscover each step by shipping it broken first. Items marked ⚠ are the ones Compress actually got wrong along the way; they are where a reviewer should look hardest.

## The shape of a mode

A mode is a **module singleton**, not a component instance: state lives at module scope, `init<Name>Workspace()` binds DOM, `cleanup()` drops DOM references but keeps state (mode switches must not lose work), `resetAll()` is the destructive cousin. `PdfWorkspace` and `CompressWorkspace` are the references. The module is **lazy**: `main.ts` imports it on first entry, so a visitor who never opens it never downloads it. Only the already-resolved module handle is used for `cleanup()` on exit.

## The checklist

### Core wiring

- [ ] **Router** (`src/router.ts`): add the mode to `AppMode` and one entry to `MODE_PATHS`. The reverse map is derived; nothing else in the router changes. Deep links, back/forward and bookmarks now work.
- [ ] **Mode registry** (`src/main.ts`): `APP_MODES`, `MODE_LABELS`, `MODE_SURFACES` (the elements the mode owns; everything else gets hidden), `MODE_ICONS`, and the enter/leave lazy init in `setAppMode()`.
- [ ] **Markup** (`index.html`): a `<main>` for the workspace, a page description below it, entries in the desktop mode dropdown *and* the mobile pill group. ⚠ The mobile menu's staggered-reveal ladder in `TopBar.css` is per-child (`nth-child`); a child past the last rung animates in *first*. Extend the ladder when the menu grows.
- [ ] **Card geometry**: if the surface has a card, it is `#convert-card`'s geometry, **measured, not eyeballed** - width, margin, padding, radius, border, on both breakpoints. ⚠ Compress shipped as a bare flex column first and every complaint about spacing traced back to that. Verify with a headless-Chromium measurement of both cards side by side.
- [ ] **Reuse the shared classes** (`.upload-zone`, `.convert-field`, `.format-selector`, `.btn-primary`, `.tab-bar`) instead of lookalikes, so the new surface inherits every future tweak.

### The parts that are easy to forget

Each of these is invisible in a demo and real in use. Compress missed several on the first pass:

- [ ] **Background emojis** (`bgEmojis` in `main.ts`): a set themed to the mode.
- [ ] **Frogsworth**: a quip pool for the mode, and clear the Converter's from/to context so the frog doesn't talk about PNG on the wrong surface (`initFrogsworth` callback).
- [ ] **Announce the mode in `CAPABILITY_QUIPS`** (`FrogsworthWidget.ts`), which is blended into *every* surface's idle chatter. ⚠ A tip scoped to the new mode's own page only reaches people who already found it; the person who needs to hear the mode exists is by definition somewhere else. One line there, and the whole app advertises it.
- [ ] **Progress and completion go through the shared modal** (`showConversionInProgress` + `ensureCancelButton` in `conversion/cancellation.ts`), with the mode added to `ConversionMode`/`modeCopy()` so the copy is in its own vocabulary. ⚠ Compress first painted its own progress bar inside the card, which made the slowest surface in the app look like the one where nothing was happening. Confetti and the dancing frog on success are part of this, not decoration: every other surface celebrates.
- [ ] **Session persistence** (`src/components/persistence/`): a payload type in `sessionStore.ts`, a persistor module, restore-on-init with a resume popup. ⚠ Validate the restored settings against the *current* option set - Compress's restore silently dropped `"auto"`, the one value most sessions were saved with.
- [ ] **Settings binding**: if the mode has a stance on compression/quality, add a row to `QUALITY_BINDINGS` in `main.ts` with its own store value, default, and per-mode title. One table row, not a new conditional. ⚠ Name the control for the mode ("PDF compression"), never bare "Compression" - a shared control in three places must say *of what*.
- [ ] **Share target** (`EXTERNAL_FILES_EVENT` in `main.ts`): decide where shared files can land and add the mode to the chooser if it's a plausible destination. ⚠ Compress shipped an `ingestExternalFiles()` that nothing called.
- [ ] **File intake**: ceiling (`ABSOLUTE_MAX_FILES`), total-size budget (`MAX_TOTAL_FILE_SIZE`), a cheap MIME filter with honest toasts, and the file input's `accept` list. ⚠ Compress's `accept` omitted PDFs - the headline format was unreachable from the browse button and only drag-and-drop masked it.
- [ ] **SEO/meta**: `index.html` descriptions, schema.org `featureList`, README, `package.json` description.

### Shared decisions belong in one module

Every one of these was a real bug, and every one of them had the same shape: a
decision that *looked* local, copied into a second place, and then diverging.

- [ ] **If the mode offers "Automatic", call `core/compression/automatic.ts`.** Do not re-derive it. That module is the single definition of probe → step down → per-format rule; it exists because three surfaces had each written their own and only some of them learned that PDFs need a different rule.
- [ ] **A heuristic advises, it never vetoes.** ⚠ The quality probe was allowed to refuse an *explicitly chosen* level on the grounds that a file "looked" already-minimal. It reads container metadata, not pixels, so this was a guess overruling an instruction - and it made image-heavy PDFs report "already compressed" at every setting. Guess on the user's behalf only when they have expressed no preference; verify by measuring the output, never by predicting it.
- [ ] **Ask what the level actually changes for each format.** ⚠ Video presets only moved size thresholds, all of which sat above 75 MB, so every ordinary clip got the same CRF and the three levels produced byte-identical files. A control that does nothing is worse than no control. Write the test that asserts two different levels produce two different plans.
- [ ] **Check how handlers declare a format before trusting a capability check.** ⚠ `handlerSupportsFormat` required one entry flagged both readable and writable. FFmpeg publishes a demuxer entry and a muxer entry separately, so no video or audio file ever resolved - Compress advertised them, accepted them, and reported "can't compress this".
- [ ] **Know which libraries take your buffers.** ⚠ pdf.js *transfers* the `data` array you hand it; the caller's view comes back detached at length 0. Three call sites in this repo already passed `.slice()`; the two that didn't corrupted the file for everything downstream. If a library might take ownership, pass a copy and capture any length you need **before** the call.

### Failure states, before polish

Design these first; they are the feature. Every async entry point must leave the surface somewhere actionable:

- [ ] **Nothing may strand the UI.** `file.arrayBuffer()` rejects when a picked file is moved or deleted - ordinary behaviour, not an edge case. An engine crash or a failed WASM instantiation must land back on the file list with a toast, not on a spinner forever. ⚠ Compress's `runCompression()` had no try/catch at all.
- [ ] **Cancellation is a contract.** Say exactly what Stop does, and report never-reached files as *stopped*, not *failed* - one is the user's decision, the other is our failure. ⚠ Prefer actually stopping to describing why you can't: Compress shipped with honest "finishes this file, then stops" copy, which was fine until the file in flight was a 2 GB video - the exact case someone presses Stop for. Every engine already ran in a terminable worker; only the batch loop was waiting.
- [ ] **An optional step needs its own exit.** ⚠ The PDF editor's compression runs *after* a finished edit, behind a popup that had no cancel: worst case a 16 MB fetch, a compile and a pass, with the 10-minute worker timeout as the only way out. A step that runs after the user's real work is complete is always safe to abandon - wire the button.
- [ ] **Copy never lies about files.** "Already as small as it gets" is only sayable when we *tried*. A real saving that rounds to 0% reads "under 1%". A degraded fallback names its cost; it is never a silent substitution.
- [ ] **Worker hygiene**: anything registered on the shared cancellation singletons is cleared when the run settles, whichever surface ran it. ⚠ A Compress run left a stale force-cleanup callback able to terminate the worker under a later, unrelated job.

### Accessibility

- [ ] Progress is a polite live region; bars carry real `progressbar` semantics with `aria-valuenow`.
- [ ] Menus: `aria-haspopup`/`aria-expanded`/`aria-current`, roving arrow keys, Escape restores focus to the trigger.
- [ ] Results/status regions announce (`role="status"`).

### Verification bar

What "done" meant for Compress, and should mean for the next mode:

- [ ] DOM tests for the workspace (intake, level/settings, failure paths, copy claims - including *negative* claims like "the privacy promise appears exactly once").
- [ ] Engine/orchestrator tests decoupled from the UI (`src/core/` stays free of `src/components/` imports; pass the handler list in, don't read the store).
- [ ] **Screenshot verification, mobile and desktop, before calling UI work done.** Two of the ugliest defects (a duplicated privacy promise, a summary row floating in a 10rem box) were invisible in code review and obvious in a screenshot.
- [ ] **Drive the real feature on a real file, end to end, against a production build.** ⚠ This is the step that catches what unit tests structurally cannot. Four separate bugs here - the probe veto, the detached pdf.js buffer, the demuxer/muxer pairing, the inert video levels - all sat behind green suites, because every one of them lived in the seam *between* mocked units. Note the dev server is not good enough for this: HMR's `?t=` cache-busting can hand a module a second copy of a store singleton, which produces failures that do not exist in the shipped app.
- [ ] **Write down the numbers you measured.** A saving of "37%" in a doc is checkable later; "compresses well" is not. Where a format behaves counter-intuitively, the measurement is the argument - see the preset table in `COMPRESS.md`.
- [ ] Layering by **hit-test** (`document.elementFromPoint` down an open dropdown), not by reading z-indexes.
- [ ] A copy sweep that includes `\uXXXX` escapes - a literal-character grep misses them.
- [ ] `tsc` clean, full unit suite, production build (`vite build`), CI green.

### Documentation

- [ ] A `docs/<MODE>.md` with frontmatter (see the top of this file), covering what it does, its limits stated honestly, and programmatic access.
- [ ] CHANGELOG entry written for the release reader, not the commit log.
- [ ] `docs/ARCHITECTURE.md` diagram and directory map, `AGENTS.md` if agents can reach it.

## The one-sentence version

A mode is done when a stranger can deep-link into it, drop the wrong file, lose their network, press Stop, restore yesterday's session, and hear it all through a screen reader - and at no point does the surface lie to them or strand them.
