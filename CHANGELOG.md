<!-- docs-frontmatter
icon: 📜
label: Changelog
desc: Release history
-->

# Changelog

All notable changes to frogConvert. Loosely follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

## [2.3.5] - 2026-05-12

Restores the background-emoji unblur-on-cursor effect that's been gone since the a11y pass back in `781f9c9`. Intended to land as part of v2.3.4 but branch protection blocks force-pushing the release commit, so it ships as a patch.

### Fixed
- **Background emojis sharpen near the cursor again.** The `#bg-visuals span:hover` rule that unblurred emojis under the pointer was deleted in `781f9c9` because those spans had to flip to `pointer-events: none` to stop swallowing real clicks — once they were unhoverable, the CSS `:hover` route was dead. [src/components/AmbientBackground/AmbientBackground.ts](src/components/AmbientBackground/AmbientBackground.ts) now drives the unblur from JS using the `dist` value already computed for parallax: spans within 140px of the smoothed cursor lerp from `blur(12px)/opacity:0.22` toward `blur(0)/opacity:0.6`. The CSS `transition: filter, opacity` on [src/styles/global.css](src/styles/global.css) was dropped — per-frame JS writes would lag-chase a 0.5s transition, and the parallax smoothing already supplies the easing.

---

## [2.3.4] - 2026-05-12

Three UI alignment fixes after on-device review: the PDF editor's content arrival now mirrors the converter card's slide-up instead of popping in, the PWA "Reload now" pill no longer ships with the browser's default 3D button bevel, and the docs theme toggle uses an actual SVG icon instead of a Unicode glyph that sat off-center inside its button.

### Fixed
- **PDF tool content arrives with an entrance, not a pop.** [src/components/PdfWorkspace/PdfWorkspace.ts](src/components/PdfWorkspace/PdfWorkspace.ts) now adds a `.ws-content-enter` class to the layout root each render function mounts (empty dropzone, merge left+right, organize left+right, watermark left+right). The outer `#pdf-tool-content.entrance.d5` already fires during the page cascade but the tool UI is lazy-loaded into it afterwards, so the slide-up played on an empty container and content then appeared with no animation, most visibly on mobile where the chunk-load gap is widest. A `shouldEnter(signature)` gate keeps the slide from replaying on in-place updates (adding a file, toggling a watermark setting) so only tool switches and empty↔populated transitions animate. New keyframe in [src/components/PdfWorkspace/PdfWorkspace.css](src/components/PdfWorkspace/PdfWorkspace.css) reuses the global `slideUp` so `prefers-reduced-motion` neutralizes it via the existing `*` gate in [src/styles/global.css](src/styles/global.css).
- **PWA "Reload now" banner button no longer has a default browser bevel.** [src/components/ConvertCard/ConvertCard.css](src/components/ConvertCard/ConvertCard.css) `.convert-notice-link` was set to `<button>` in [src/pwa/registerSW.ts](src/pwa/registerSW.ts) when the update prompt was extracted from inline styles, but never reset the browser's default `outset` button border. That painted as darker arcs at the top-left and bottom-right of the pill — visible on dark mode in particular. Added `border: none` plus an explicit `cursor: pointer` (now that it's a `<button>` and not an `<a>`).
- **Docs theme toggle icon centers in its button.** [src/docs/theme.ts](src/docs/theme.ts) was writing the Unicode glyphs `☼` (U+263C) and `☽` (U+263D) into `#theme-toggle` via `textContent`. The fallback font's glyph metrics for those characters put the visible shape in the upper half of the em-box, so even with the button flex-centered the icon read as drifting toward the top. Switched to inline Lucide SVGs (`Icons.moon` / `Icons.sun`, added to [src/components/icons.ts](src/components/icons.ts)) so the icon is geometrically centered like every other icon-only control. The HTML fallback in [docs/index.html](docs/index.html) keeps `&#9790;` for the no-JS case.

---

## [2.3.3] - 2026-05-12

Lighthouse audit cleanup plus a cold-start splash so the page no longer flashes blank while phase-2 handlers are still downloading. Source maps reach DevTools, agent-readable docs are honest, and the markdown URLs advertised to crawlers actually serve markdown.

### Added
- **Cold-start splash overlay.** [index.html](index.html) ships an inline `#cold-start-splash` div (frog logo + title + indeterminate progress bar) styled via an inline `<style>` block so it renders before any JS or CSS chunk arrives. The overlay is dismissed when [src/main.ts](src/main.ts) adds `body.app-ready` at the end of the loading sequence, with a 15s safety-net `setTimeout` so a boot crash can't lock the user on the splash. The existing FOUC gate moved off inline `style.cssText` mutations to `html.app-loading` / `html.app-revealed` classes for cleaner cascade.
- **[public/llms.txt](public/llms.txt)** per the [llmstxt.org](https://llmstxt.org/) spec: H1 title, blockquote summary, link sections for project / user docs / contributor docs / crawler policy. Every URL points at `/docs/*.md` (verified to serve `text/markdown`) instead of the root-level paths that return HTML in production. Fixes Lighthouse's `llms-txt` failure (Agentic Browsing 67 → 100).

### Fixed
- **Source maps now resolve in DevTools.** [vite.config.js](vite.config.js) was building with `sourcemap: 'hidden'` — `.map` files were emitted but the `//# sourceMappingURL=` comment was stripped from every chunk, so DevTools couldn't auto-load them and Lighthouse's `valid-source-maps` audit failed. Flipped to `sourcemap: true`. No bundle-size delta (maps were already on disk), no privacy delta (public repo).
- **Root-level `/README.md`, `/CHANGELOG.md`, `/SECURITY.md`, `/AGENTS.md` no longer 404-as-HTML.** Those URLs were advertised in [public/robots.txt](public/robots.txt) but the Netlify SPA fallback was serving `text/html` (the converter page) at them; markdown crawlers got the index page instead of the docs. Re-pointed the `robots.txt` comments at `/docs/<file>.md` (where `viteStaticCopy` actually mirrors root markdown via `{ src: "*.md", dest: "docs" }`).
- **`LICENSE` now ships in `dist/`.** The `viteStaticCopy` glob `*.md` didn't match because `LICENSE` has no extension. Added `{ src: "LICENSE", dest: "docs" }` in [vite.config.js](vite.config.js) so `https://frogconvert.xyz/docs/LICENSE` resolves.
- **`#loading-bar` respects iOS safe-area inset.** [src/styles/global.css](src/styles/global.css) fixed-position bar was sitting at `top: 0`, ending up under the notch / Dynamic Island on iOS PWAs. Switched to `top: env(safe-area-inset-top, 0px)`.
- **`.convert-notice` mobile layout switches at the right breakpoint.** [src/components/ConvertCard/ConvertCard.css](src/components/ConvertCard/ConvertCard.css) was vertical-stacking notices only below 600px, but `MOBILE_BREAKPOINT` is 800px everywhere else. Aligned to 800px.

### Changed
- **PWA update banner moved off inline styles.** [src/pwa/registerSW.ts](src/pwa/registerSW.ts) was setting `position: fixed; bottom: 1rem; right: 1rem; ...` via `notice.style.cssText`. Extracted to `.convert-notice-pwa-update` in [src/components/ConvertCard/ConvertCard.css](src/components/ConvertCard/ConvertCard.css) with `env(safe-area-inset-bottom)` for notch handling and a `slide-up-fade` entrance.
- **Docs topbar controls now use the `--control-size` token.** [src/styles/docs.css](src/styles/docs.css) `.topbar-btn`, `#theme-toggle`, `#nav-toggle` migrated off hardcoded `2rem` heights/widths. `--topbar-h` recomputed from the same token. Added `line-height: var(--leading-none)` so glyph-only buttons don't drift vertically. Drops the duplicate mobile padding rule.

### Internal
- **`.page-title` mobile sizing.** [src/styles/global.css](src/styles/global.css) bumps the title to `2.25rem` with extra top margin at ≤800px; [src/components/TopBar/TopBar.css](src/components/TopBar/TopBar.css) keeps the ≤400px font-size override but drops the now-redundant margin rules. Cleaner cascade, no visual change at supported widths.

---

## [2.3.2] - 2026-05-09

Three quiet defects fixed: a missing icon on the Electron build, a `manifest.webmanifest` 404 firing on every dev / E2E / desktop session, and uncaught `THREE.WebGLRenderer` failures on hardware-acceleration-disabled environments.

### Fixed
- **Electron app icon.** `electron-builder` was building NSIS / DMG / AppImage artifacts with the default Electron icon — `package.json` `build` block had no `icon` field. Added `"icon": "public/icon-512.png"` (cross-platform; electron-builder generates per-target sizes from the 512 PNG). `BrowserWindow` in [src/electron.cjs](src/electron.cjs) also now passes `icon:` so the running window — taskbar on Linux, window-frame on Windows — shows the frog instead of the default Electron logo.
- **`Manifest fetch from .../manifest.webmanifest failed, code 404`.** [index.html](index.html) hardcoded `<link rel="manifest" href="/manifest.webmanifest">`, but `vite-plugin-pwa` is only active for the production-web build (gated off for desktop via `!isDesktopBuild`, off for dev via `devOptions.enabled: false`). So dev, Puppeteer E2E (`vite createServer` random port) and the Electron desktop build all hit a 404 on every page load. The static link is now removed; `vite-plugin-pwa` already injects a `<link rel="manifest">` automatically during the production-web build, and emits nothing in the gated-off paths — so the link only ships when the file actually does.
- **`THREE.WebGLRenderer: A WebGL context could not be created`** on systems where ANGLE falls back to the Microsoft Basic Render Driver (CI runners, VMs, RDP, `--disable-gpu` Chromium). Three handlers (`threejs.ts`, `sppd.ts`, `bsor/renderer.ts`) instantiated `WebGLRenderer` with no probe and no try/catch; three.js then logged its three internal errors and threw uncaught. New shared bootstrap [src/handlers/_webgl.ts](src/handlers/_webgl.ts) pre-flights with a cheap `canvas.getContext('webgl2'||'webgl')` probe and wraps the constructor — failures surface as a single, actionable error ("WebGL is not available… enable hardware acceleration") through the normal conversion-error channel.

### Privacy
- **No more Google Fonts.** [index.html](index.html), [public/404.html](public/404.html), [docs/index.html](docs/index.html), and [docs/slidedeck.html](docs/slidedeck.html) had a `<link rel="preconnect">` plus a parallel `<link rel="stylesheet">` to `fonts.googleapis.com`, loaded on every page visit. Inter is already bundled via `@fontsource-variable/inter` (imported in [src/styles/global.css](src/styles/global.css)) and the system-font fallback chain in `--font-sans` covers any load failure. The Google Fonts links were dropped entirely. No more font-CDN referer/IP leak.
- **[SECURITY.md](SECURITY.md) rewritten** to reflect the actual behavior: MCP runs over stdio (not a port), no font CDN, no SLA / ack-within-X-days commitments. Hobby project, single maintainer.

### Internal
- Unit test [src/handlers/_webgl.test.ts](src/handlers/_webgl.test.ts) covers the probe-fail, constructor-throw, and happy paths so the WebGL fallback can't silently regress.

---

## [2.3.1] - 2026-05-09

Internal polish on top of v2.3.0: design tokens consolidated at `:root`, unified `:focus-visible` contract across every interactive surface, and a small Organize-view trim.

### Changed
- **"Add blank page" trailing card removed from Organize.** It was a literal duplicate of the existing `ws-page-insert-trailing` `+` button that already inserts a blank page at the end. Same handler (`insertBlankPage(pages.length)`), same affordance — the second card was dead UI.
- **`:focus-visible` rings unified onto a single contract.** `outline: 2px solid var(--primary); outline-offset: 2px; box-shadow: none` across `icon-btn`, `cat-tab`, `format-option`, `pill-option`, `btn-primary`, `btn-secondary`, `btn-tertiary`, `ws-btn`, `close-btn*`, `pagination-btn`, `ws-page-card`, `ws-file-card`, `ws-wm-slider`, `floating-card-surface`, `toolbar-primary`. Drops the double-shadow ring; outline-only respects forced-colors mode.
- **`--touch-target` token (2.75rem)** added at `:root`. `.close-btn-md` bumped 2.5rem → 2.75rem under `(any-pointer: coarse)` to hit WCAG 2.5.5.
- **Resume popup copy simplified.** `N PDF · M pages`, drops the "Undo history will reset" and "custom watermark" hints. The summary already conveys the load on next render.

### Internal
- **Design tokens consolidated at `:root`.** New `--rainbow-gradient` (single source for the selected-state ::before border), `--transition-fast/normal/slow/spring`, `--ease-out-expo`, full `--z-*` scale (`z-base` … `z-skip-link`), and `--bp-*` breakpoint references. Rename rather than restack — zero visual change. 11 component CSS files migrated off hardcoded durations and z-indices.
- **PdfWorkspace class-name pruning.** `.ws-file-add` / `.ws-page-add` removed; `.ws-dropzone` (from `createDropzone`) carries the drop-target visual; `.ws-file-card` / `.ws-page-card` carry grid-cell shape. Two classes compose without an add-only third. Sortable `draggable` selector and click-delegation guard updated to match.
- **Mobile toolbar primary buttons** (Merge, Watermark export, Extract, Export PDF) inherit the unified focus ring via `.toolbar-primary`.
- **`floating-card-surface`** removed from `ws-page-plus` — the per-card plus-buttons live on top of the page card and don't need their own surface.

---

## [2.3.0] - 2026-05-08

frogConvert is now an installable Progressive Web App with offline support and resumable sessions. Drop a file, close the tab, come back — your work is offered back to you. Share files into frogConvert from the OS share sheet or "Open with…" menu. Conversion handlers and assets cache as you use them so repeat conversions work offline.

### Added
- **Service worker and Web App Manifest.** Install prompt on Chromium / Edge / Safari; standalone display; iOS apple-touch-icon and status-bar styling; Android adaptive icons (maskable). Offline-ready toast on first install, dismissable update banner when a new version is available — never silent skipWaiting (`registerType: 'prompt'`).
- **Web Share Target.** A POST handler in [src/pwa/sw.ts](src/pwa/sw.ts) accepts multipart shares from the OS share sheet, writes the payload to a dedicated CacheStorage entry, and redirects to `/?share-target=ready`. The page replays from cache and routes files into the Converter or PDF Editor based on file type. Capped at 25 files / 500 MB total per share.
- **File handlers (`launchQueue`).** "Open with frogConvert" registers for image / video / audio / PDF / text / ZIP / 7z extensions; files arrive via the same `EXTERNAL_FILES_EVENT` path as share-target.
- **Resume prompt.** Cold-start with a saved session of the same kind shows a "Resume your last conversion?" / "Resume your PDF workspace?" popup. Same-tab reload silently restores instead. Tab-clone (Chrome "Duplicate tab") detected via BroadcastChannel and routed to the orphan path so two tabs never last-write-win on the same sessionId.
- **Session persistence — Converter.** Files, target format, page selection survive tab close, browser restart, and accidental mode-switches. Bytes round-trip as `Uint8Array` through IndexedDB.
- **Session persistence — PDF Editor.** Files, active tool tab (Merge / Organize / Watermark), page selection, watermark settings (text, size, color, opacity, rotation, repeat-mode, page range) all persist across reload.
- **Cache-size helpers.** `getTotalCacheBytes`, `clearAllCaches`, `formatCacheBytes`, `sumCacheBytes` in [src/pwa/cacheControls.ts](src/pwa/cacheControls.ts) — wiring for a future Settings affordance.

### Changed
- **Mobile category filter auto-resets** on entering `(max-width: 800px)`. The category strip is hidden on mobile, so leaving an active category set silently filtered the format list with no way to clear it. The `change` listener now resets the filter when crossing into the mobile breakpoint.
- **Top-bar control icons** redrawn on a unified 16×16 grid (`.top-control-icon` class) for visual parity across mode / theme / app-mode toggles. Theme toggle gained a proper SVG moon glyph in place of the `&#9788;` codepoint, which rendered inconsistently across fonts.
- **`apple-touch-icon`** now points at `/apple-touch-icon-180.png` instead of the favicon, so iOS home-screen installs get a real 180×180 icon instead of an upscaled 32×32 favicon.
- **Documentation pass.** README headline bumped, ARCHITECTURE gained PWA + persistence sections, CLAUDE.md file map covers the new directories, CONVERTER and PDF_EDITOR mention Install / Share / Resume, DEPLOYMENT documents the SW serving headers, SECURITY notes the local CacheStorage footprint.

### Fixed
- **Watermark flat-page list desync after file mutations.** `wmFlatPages` was rebuilt only on tab activation; removing a file from the sidebar while the Watermark tab was inactive left a stale flat-index map. `onFilesMutated()` now calls `wmSyncWithFiles()` first so the next render sees a consistent view.
- **Centralised dirty tracking in PdfWorkspace.** Per-mutation-site `markDirty` calls were drifting (some paths missed manifest-only updates after reorder). All file/state mutations now route through the shared mutation hook, so a save is never missed.

### Internal
- **`src/pwa/`** — service worker, registration, share-target replay, cache controls, constants. Workbox runtime caches: CacheFirst for `/wasm/` (30 entries, 7-day TTL, status 200 only — opaque cross-origin entries rejected), StaleWhileRevalidate for `/assets/` (200 entries, 30-day TTL), `/js/`, `/docs/*.md`. NavigationRoute precaches `/index.html` with a denylist for `/api`, `/.well-known`, `/docs`, `/headless`. JS chunks runtime-cached, not precached, so install isn't a 17 MB download.
- **Custom share-target fetch listener installed before Workbox's `registerRoute`.** A multipart POST to `/` has `request.mode === "navigate"` and would otherwise be eaten by the precached `/index.html` NavigationRoute. Order is load-bearing.
- **`src/components/persistence/`** — IndexedDB-backed session store (two stores: `sessions` keyed by sessionId, `fileBytes` keyed by `<sessionId>:<fileId>`), generic `createPersistor` factory, Converter-specific wiring. PDF Workspace inlines the same factory at [src/components/PdfWorkspace/PdfWorkspace.ts](src/components/PdfWorkspace/PdfWorkspace.ts).
- **Manifest-last write order.** Bytes write before manifest, so a tab kill mid-flush leaves a stale manifest pointing only at fileIds whose bytes already landed — never a manifest referencing unwritten bytes. Quota-exceeded errors pause autosave with a single warning toast; non-quota errors (missing file, serialization) skip the id and continue.
- **`bumpNextFileId`** in [src/tools/types.ts](src/tools/types.ts) so restored sessions don't collide with fresh file ids minted in the same browser session.
- **Build-time PWA wiring.** [vite.config.js](vite.config.js) gains `vite-plugin-pwa` (`injectManifest` strategy, `srcDir: 'src/pwa'`, `globPatterns` precaches HTML/CSS/icons/fonts only). Disabled for desktop builds (`!isDesktopBuild`) since Electron runs from `app://` where a service worker is both useless and a registration footgun.
- **nginx + Netlify**: `Service-Worker-Allowed: /` on `/sw.js`; no-cache on `/sw.js` and entry HTMLs (`/index.html`, `/docs/index.html`, `/headless/index.html`); immutable 1y on `/wasm/*`; correct `application/manifest+json` for `/manifest.webmanifest`.
- **Tests.** New unit suites: `registerSW.test.ts` (env gating: Electron / file-protocol / no-window skip), `shareTarget.test.ts` (cache replay + `launchQueue` consumer), `cacheControls.test.ts` (byte formatting + sum), `sessionStore.test.ts`, `createPersistor.test.ts` (dirty tracking, manifest-last invariant, quota pause).
- **Dependencies.** `vite-plugin-pwa ^1.3.0`, `workbox-window ^7.4.1`. Workbox runtime modules pulled transitively.

---

## [2.2.1] - 2026-05-07

Audit-driven patch release. Three Critical-class data-loss paths closed, mobile-first touch and a11y sweep across both routes, watermark preview rebuilt on a synchronous bitmap cache, and power-user keyboard productivity in the PDF Editor and Format modal.

### Fixed
- **App-mode switch no longer destroys PDF workspace state.** Toggling between Converter and PDF Editor used to call `resetAll()` on the workspace, wiping loaded files, page reorder, watermark settings, and the undo history. Users who organized a long PDF and tapped the mode toggle by mistake (or to glance at the converter copy) returned to an empty workspace with no recovery. The mode-out path now calls `cleanup()` instead — DOM listeners and the body-mounted toolbar/tray are torn down, but module state is preserved. `initPdfWorkspace()` re-renders on subsequent calls so coming back remounts the UI on the existing data.
- **Success popup no longer eats your file when closed early.** The post-conversion popup launched a `setTimeout(downloadAllConvertedFiles, 400)` gated on `popupBox.classList.contains("open")`. Fast-clickers who tapped *Done* before 400 ms got confetti but no download. Blob URLs are independent of popup lifetime, so the guard was dropping the file for no reason. Removed; downloads now fire unconditionally. Confetti stays popup-anchored.
- **Files modal no longer replaces your file list when you drop on its background.** Drops anywhere on the modal except the inner *Drop more PDFs* zone bubbled to UploadZone's window-level handler, which silently called `proceedWithFiles()` and replaced `currentFiles`. Capture-phase `dragover`/`drop` listeners on the modal element now claim drops while open and route to `addMoreFiles()`.
- **Mobile last grid row no longer hidden behind the fixed toolbar.** `.ws-grid-card` `padding-bottom` recomputed via `var(--space-12) + var(--space-6) + var(--space-3) + env(safe-area-inset-bottom)` (single-row toolbar) and `+ var(--space-12) + var(--space-4)` more for the Organize two-row variant, so the last row of thumbnails has 20 px of breathing room above the floating toolbar.
- **Mascot apology removed from Safari PDF error popup.** The Safari-specific error message ended with `Frogsworth is sorry`, which violated the CLAUDE.md "no mascot catchphrases" rule inside a critical-error popup. The message already names the escape route (Chrome / Firefox); the kaomoji was noise.
- **Em dash in `showDetectedFormat` copy** replaced with a comma per the project copy rule (no em dashes in user-facing strings).
- **Files modal `.file-row` no longer pretends to be clickable.** `cursor: pointer` was set without a row-level click handler — only inner buttons were interactive. Pointer cursor dropped.
- **`.popup-actions` vs `.popup-actions-footer` inconsistency.** `showSizeWarningPopup` migrated from the legacy ad-hoc class to the shared `.popup-actions-footer` so size-warning, success, and error popups render their action rows identically.

### Added
- **Ctrl/Cmd+Click for non-contiguous page selection** in the PDF Editor's Organize tab. `toggleSelection()` takes a third `ctrl` flag that explicitly toggles the clicked page and overrides Shift, matching the Windows / macOS multi-select convention so power users can pick or unpick a single page without disturbing a Shift range. Plain click and Shift+Click behavior unchanged.
- **Redo (Ctrl+Y / Ctrl+Shift+Z)** in the PDF Editor. A 30-snapshot redo stack runs alongside the existing undo history. New mutating actions clear the redo branch (same convention as code editors and image tools). `cleanup()` and `resetAll()` clear both stacks.
- **Arrow-key navigation across the Format modal options.** ↓ from the search input pulls focus into the first visible option; ↑ from the first option pulls focus back into search. ↑/↓/Home/End move within the option list. Saves keyboard users ~70 Tab presses to reach the bottom of the All Formats list.
- **Arrow-key navigation across the PDF Editor tab bar.** Arrow Left / Right / Home / End move focus between Merge / Organize / Watermark inside the new tablist.
- **Move ▲ / ▼ buttons in the PDF mobile tray.** Touch users couldn't reorder pages because the long-press drag fought page scrolling and the move-row was hidden behind the desktop-only `body.ws-keyboard-mode`. The tray now exposes Move up / Move down buttons that reuse the existing `moveSelection()`, giving touch users a non-drag reorder path.
- **Mobile dismiss button on toasts.** Toasts had click-to-dismiss but no announced affordance for screen-reader or keyboard users; a real `× Dismiss` button now lives inside every toast with `aria-label="Dismiss"`.
- **Skip-link** for keyboard users. The first Tab from the address bar now reveals a visible "Skip to content" link that jumps to `<main>`, saving the previous ~10 Tab stops through nav controls.

### Mobile
- **Touch-target sweep across the app** under `@media (any-pointer: coarse)`. `--control-size` bumped from 36 px to 44 px (WCAG 2.5.5), `.icon-btn`, `.close-btn-md`, `.close-btn-lg`, `.pagination-btn`, the Files modal "Replace all"/"Remove all" buttons, `.cat-tab` rows, `.format-option` rows, the Watermark Customize summary, and the watermark slider hit area all hit 44 × 44. `(any-pointer: coarse)` was chosen over `(pointer: coarse)` so hybrid touch laptops get touch-density even when a mouse is also present.
- **iOS focus-zoom killed without scaling the type system.** Inputs receive a surgical `font-size: 16px` under `(any-pointer: coarse)` that prevents Safari from zooming on focus. The 13 px `--text-base` token stays untouched, so the design scale is unchanged.
- **Watermark slider hit area extended.** Slider track stays 4 px tall but the input element's hit area now spans 44 px so finger-drag on opacity / rotation actually works.
- **UploadZone file-info row wraps actions to a second line on touch** so the three icon buttons (manage / replace / remove) never crowd the filename.
- **Mobile toolbar tracks the virtual keyboard.** A `visualViewport` listener writes `--kb-offset` to the document element and `.ws-toolbar { bottom: ... + var(--kb-offset) }` slides the Export button above the on-screen keyboard. The Watermark text input no longer hides Export behind the keyboard.
- **Watermark input quick-flow** + empty-text passthrough — typing nothing no longer blocks export; the source PDFs are saved unchanged.

### Accessibility
- **`prefers-reduced-motion` is now respected app-wide.** A global CSS gate caps every animation and transition to 0.01 ms. The AmbientBackground parallax loop has a parallel JS guard since inline-style writes bypass the CSS gate. Bg-emoji floats, frog-pulse, ws-shimmer, ws-spin, dot-pulse, files-error-slide-in, and the entrance animations all stop when the system pref is on.
- **`:focus-visible` rings on every affordance that strips outline elsewhere.** `.icon-btn`, `.cat-tab`, `.format-option`, `.pill-option`, `.btn-primary`, `.btn-secondary`, `.ws-btn`, `.close-btn`, `.pagination-btn`, `.ws-page-card`, `.ws-file-card`, `.ws-wm-slider` — keyboard users now see a 2 px primary ring (with 2 px offset) on focus.
- **PDF Editor tab bar marked as a `role="tablist"`** with `role="tab"` + `aria-selected` + `aria-controls` per button and roving `tabindex`. The active tab's id flows into `aria-labelledby` on the tabpanel. Screen readers announce "tab, 2 of 3, Organize, selected" instead of three loose buttons.
- **Page cards and file cards moved to `role="button"` + `aria-pressed` + `tabindex=0` + `aria-label`** (e.g. "Page 5 of 12, not pressed"). Selection state is now announced; the previous mix of `aria-checked` without a matching role was inert for AT.
- **Watermark `.ws-wm-status` gets `aria-live="polite"`** so SR users hear export progress and validation states.
- **Toast role / live-region differs by variant.** `variant-error` uses `role="alert"` + `aria-live="assertive"`; info/warn use `role="status"` + `aria-live="polite"`. Severity is also conveyed beyond color: `⚠` icon prefix on warn / error variants (WCAG 1.4.1).
- **Mobile menu marked as a `role="dialog" aria-modal="true"` with focus trap.** Tab and Shift+Tab cycle within the menu, Escape closes, focus restores to the hamburger button. The hamburger's `aria-expanded` now flips with menu state.
- **Light-mode `--muted-foreground` bumped from `#71717a` to `#5f5f6a`** so 11 / 12 px muted text passes WCAG AA (≥ 4.5 contrast).
- **Headlines selectable.** `.page-title`, `.page-description`, and `.footer-text` shed `pointer-events: none` (z-index already separates them from `#bg-visuals`).
- **Background-emoji mouse-trap killed.** `#bg-visuals span` flipped to `pointer-events: none`; emojis no longer steal mouse events from interactive content under them.
- **Native I-beam restored on text inputs while the custom cursor is active.** `html.custom-cursor-active *` set `cursor: none !important`, hiding the I-beam from `<input type="text">` and `<textarea>`. A targeted override under `(pointer: fine)` brings it back.

### Performance
- **Watermark preview rebuilt on a synchronous bitmap cache.** The previous URL cache + 250 ms debounce timer is gone. Each page is now rendered once via pdfjs (lazy, on intersection-observer entry) into an `ImageBitmap`, and every settings change composites that cached bitmap with a Canvas 2D watermark overlay synchronously on the next animation frame. No PDF round-trip per slider tick. LRU-bounded at 200 entries (~45 MB ceiling). Slider drag is now smooth instead of stuttering.
- **TopBar scroll listener rAF-coalesced** so `.scrolled` class toggles fire at most once per frame instead of per scroll event (40-100× reduction in style recalcs on fast scroll).

### Internal
- **`--button-surface` token** added to the design system: light theme maps to `--secondary`, dark theme overrides to `--card`. ~25 button definitions across 9 components consolidate onto the single token, removing the `.dark .btn-secondary` override cascade. Top-bar buttons opt out and bind directly to `--card` so they always match the base card surface.
- **`cleanup()` exported from PdfWorkspace** for app-mode switches that should preserve module state.
- **Build hardening.** Puppeteer timeouts lengthened in the cache-build script and on-failure error surfacing so cold-start cache rebuilds don't fail silently in CI.

---

## [2.2.0] - 2026-05-07

Watermark tab for the PDF editor, plus a sweep of accessibility fixes across the workspace.

### Added
- **Watermark tab in the PDF Editor**: Stamp a text watermark on all pages or a custom range like `1-3, 8, 10-12`. Style controls: size, color (hex + swatch), opacity, rotation. Toggle **Repeat across page** to tile the watermark with internally-computed spacing. Live preview reflects the actual export and reserves aspect-ratio so the page renders instantly without layout shift. Helvetica-only text with character-set validation. Available in the UI, MCP (`pdf_watermark`), and REST (`POST /pdf/watermark`).
- **Shared sidebar primitives** in `PdfWorkspace.ts` (`makeSidebarFileRow`, `makeSidebarDivider`, `makeSectionLabel`) so Merge / Organize / Watermark render the file row and divider markup from one source.

### Changed
- **Watermark UI unified with Merge/Organize**: same active-file row at the top of the sidebar, same Select all / Deselect all pattern, same sticky-bottom mobile toolbar + tray drawer.
- **Watermark MCP/REST surface narrowed to text-only**: `source` discriminator and `placement` field removed from `pdf_watermark` and `POST /pdf/watermark`. `text`, `fontSize`, `colorHex` are now top-level fields; placement is always center. Image-source watermarks have been removed from the public API to match the UI.
- **Watermark UI defaults aligned with engine**: the workspace now derives `fontSize` (`80`) and `opacity` (`0.5`) from `WATERMARK_DEFAULTS` in [src/tools/pdfWatermark.ts](src/tools/pdfWatermark.ts) instead of holding its own values (previously `64` / `0.2`). UI, MCP (`pdf_watermark`), and REST (`POST /pdf/watermark`) defaults are now identical.

### Fixed
- **Combined-mode watermark output filename**: `doWatermarkExportCombined` no longer double-suffixes (e.g. `report_watermarked_watermarked.pdf` → `report_watermarked.pdf`). Now reuses `merge()` from [src/tools/pdfMerge.ts](src/tools/pdfMerge.ts) instead of an inline `PDFDocument.create()` loop.

### Accessibility
- **Watermark tab is now keyboard- and screen-reader accessible**:
  - Page cards are tabbable (`tabindex=0`), have programmatic names (`Page A1`, `Page B3`, etc.), and toggle on `Space` / `Enter` (matching the Organize tab).
  - Sliders (`Size`, `Opacity`, `Rotation`) gained a thumb-bound `:focus-visible` ring (the previous `outline: none` left keyboard users with no visible focus indicator — WCAG 2.4.7).
  - Inputs that surface error states (`Watermark text`, `Color hex`, `Page range`) now toggle `aria-invalid` alongside the existing red border. The text input is wired to its error message via `aria-describedby` so screen readers announce *why* the input is invalid.
  - The disabled `Export PDF` button is wired via `aria-describedby` to its status paragraph, so AT users hear *why* it's disabled (e.g. "Pick at least one page").
  - The `Color` row is now a `role="group"` labelled by the visible `Color` text, tying the hex field and swatch together for AT.
  - Visible labels (`Text`, `Size`, `Color`, etc.) link to their inputs via `aria-labelledby`, eliminating drift between visible and announced names.
- **PDF Workspace: cross-tab a11y improvements**:
  - The mobile **More options** tray is now a proper `role="dialog"` with an accessible name, an `Escape` close handler; focus moves into the tray on open and returns to the trigger on close.
  - Drop-zone "Add more PDFs" cards are now keyboard-activatable (`role="button"`, `tabindex=0`, `Space` / `Enter`), with a visible `:focus-visible` ring.
  - Page cards across all tabs gained an on-brand `:focus-visible` ring.
  - The internal `el()` helper now routes `role` and ARIA attributes via `setAttribute`, so the workspace no longer relies on ARIAMixin IDL reflection (patchy in older Firefox/Safari and jsdom).

### Performance
- **Watermark preview**: lazy-render observer unobserves cards after first paint (subsequent re-renders go through `wmKickVisible` directly), and the Helvetica encode probe is memoized per-text so a 300-page grid runs `font.encodeText()` once per text change instead of once per visible card.

## [2.1.3] - 2026-05-04

Error-copy normalization, quality-resolution unification, and palette-PNG encoding.

### Added
- **Unified error copy via `toUserErrorText`**: Worker crashes, password-protected files, parse failures, timeouts, and empty-output errors now map to consistent friendly messages across UI, REST API, and MCP. Title constants shared from `src/components/utils/index.ts`.
- **PDF feedback contact line**: PDF Workspace and `pdf_*` MCP tools / `/pdf/*` API surface "Still stuck, or want to share feedback? Email francois.prevot@frog.co." for non-validation failures, distinct from the format-request line on the converter side.
- **`resolveEffectiveQuality`** (`src/core/compression/resolveEffectiveQuality.ts`): API/MCP requests now match the web UI's silent same-format auto-tier-down. Cross-format requests fall back to `medium`; same-format requests probe the input and pick the next lower tier; already-minimal inputs return unchanged.
- **Palette-PNG encoding** (`src/tools/palettePng.ts`): UPNG-based indexed-palette PNG encoder. `pdftoimg.ts` and `canvasToBlob.ts` use it at low/medium presets for document-like inputs (~3–5× smaller deflate at indistinguishable visual quality).
- **`ValidationError`** in `src/mcp/core/fileInput.ts`: tagged class for caller-supplied input failures. API/MCP catch-alls surface its message verbatim; everything else flows through the friendly normalizer.

### Changed
- **Deeper theme contrast**: Dark-mode background `#0a0a0a` → `#000000` with card `#141414` → `#0a0a0a`. Light-mode card `#ffffff` → `#fdfdfd` for subtle separation from the page background.
- **Removed "in frogConvert" phrasing**: "Not in the converter yet" → "Conversion not available yet"; "isn't in frogConvert yet" → "isn't available yet". Applied across UI, REST `/path` and `/convert`, MCP `find_conversion_path` and `convert_file`, and the format modal's no-outputs message.
- **Sharpened unreadable-file copy**: "Another copy might work" → "Try re-exporting it or uploading a fresh copy."
- **Worker-crash detail**: "The conversion stumbled while processing this file." → "The converter crashed while processing this file."

## [2.1.2] - 2026-04-29

More PDF routes via LibreOffice.

### Added
- **LibreOffice now accepts HTML, RTF, TXT, CSV, and EPUB inputs**: Unlocks alternative PDF routes such as `md → html → pdf` alongside the existing `md → docx → pdf`, plus direct `txt → pdf`, `rtf → pdf`, `csv → pdf`, `html → pdf`, and `epub → pdf` when LibreOffice is available (native binary or localhost API).

## [2.1.1] - 2026-04-22

Audio-to-video uploadability and phase-aware progress UI.

### Fixed
- **Audio → video produces a real video stream**: MP3 → MP4 (and MOV, MKV, M4V, AVI, FLV, TS, MTS, WebM) now embed a bundled placeholder frame so the output is accepted by YouTube and similar platforms. Previously the container held an audio track only.

### Changed
- **Phase-aware spinner**: The pathfinding, WASM handler download, and file-reading phases now show the plain rotating spinner. The gooey spinner stays for the actual encode/compress phase so the UI reflects what the app is really doing.

## [2.1.0] - 2026-04-18

Adaptive compression and live conversion feedback.

### Added
- **Same-format compression**: Re-encodes PNG, MP4, MP3, etc. to reduce file size with a 2% safety fallback.
- **Compress button**: UI automatically switches to "Compress" when a same-format re-encode is detected.
- **Size delta reporting**: Success popups now show exact megabyte savings and percentage reductions.
- **Conversion notices**: Detailed cards explain handler adaptations (e.g., resolution caps or codec changes).
- **Live progress**: Dynamic updates showing elapsed time and handler status for conversions over 10 seconds.
- **Honest cancellation**: Interrupting a batch now reports exactly which files were finished.
- **Adaptive sampling**: Video-to-image extraction targets 300 frames based on duration instead of a fixed rate.

### Changed
- **Archetype-aware quality**: Tailored presets for photos (Q90), PDF pages (Q87), and video frames (Q78).
- **Proactive codec handling**: Skips re-encoding for compatible streams (MP3/AAC/FLAC) and snaps to supported sample rates.
- **PDF safeguards**: Auto-shrinks documents exceeding browser safety limits (600 MP).

## [2.0.0] - 2026-04-17

In-browser PDF Editor, 70+ formats, and security hardening.

### Added
- **PDF Workspace**: Merge, reorder, rotate, and extract pages entirely in-browser using `pdf-lib` and `pdfjs-dist`.
- **Extended Formats**: Expanded support to over 70 file formats across all conversion engines.
- **Upload UX**: Front-load validation with drag-reject feedback and legacy Office format hints.
- **Toast component**: Accessible, dismissable notifications for info, warnings, and errors.

### Stability
- **Security Hardening**: Origin/Host validation for local API, post-body shape checking, and sandbox constraints.
- **Resource Protection**: Archive size caps guard against zip-bombs; HTML sanitization prevents network leaks during conversion.
- **Cleanup Overhaul**: try/finally cleanup for workers, aggressive subprocess termination, and stale temp dir sweeping.
- **Recovery System**: Global error listeners surface actionable popups instead of leaving the UI stuck.

### UX & Performance
- **Unified Selection**: Standardized tap-to-toggle and shift-click range selection across mobile and desktop.
- **Batch Summaries**: Detailed modals showing added vs. skipped files with specific rejection reasons.
- **MIME Priority**: Preferred over filename extensions for more reliable format detection.
- **Performance**: TraversionGraph lookups optimized from linear time to constant time using a Map.
- **Mobile Polish**: Two-row PDF toolbar layout with a dynamic kebab tray for better accessibility.


## [1.0.x and earlier]

Pre-changelog releases. Notable additions since forking from [Convert to it!](https://github.com/p2r3/convert):

- MCP server and REST API for AI agents ([docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)).
- Quality presets (low / medium / high / lossless) for FFmpeg, ImageMagick, pdftoimg.
- LibreOffice handler for DOCX/PPTX/XLSX to PDF.
- Soft cancel and partial downloads for batch conversions.
- Format Mode system (Core / Plus / All).
- Frame extraction for animated formats and videos.
- ICO multi-size bundles.
- Web Worker offloading for heavy conversions and route finding.
- Frogsworth mascot.
- Full Vitest + Puppeteer test suite.
