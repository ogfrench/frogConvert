<!--
Body for the GitHub Release, passed to softprops/action-gh-release as
`body_path` in .github/workflows/electron.yml.

It exists because the release body is otherwise whatever
`generate_release_notes` produces, so recutting a tag silently replaced
hand-written notes with a bare "What's Changed" list. Keep this file in step
with the version being tagged; the generated PR list is appended below it
automatically, so do not paste one here.
-->

## What's new in 3.5.6

Dependency maintenance and critical-advisory remediation, with no new conversion features.

- **Runtime security:** pin transitive `proxy-addr` to 2.0.8 and `hono` to 4.13.20 to replace vulnerable versions inherited through the MCP SDK/Express dependency tree.
- **Build security:** pin transitive `tar` to 7.5.23 and add a critical-severity Bun audit check in CI.
- **Dependencies:** update `vite-plugin-pwa` to 2.0.0 and `fake-indexeddb` to 6.2.8.
- **PDF security:** upgrade `pdfjs-dist` to patched 6.2.108 (GHSA-hq66-cqwq-w95j), with PDF.js v6 document cleanup changes. The PDF Editor and desktop rendering paths require regression testing.
- **Conversion fidelity:** retain `@imagemagick/magick-wasm` 0.0.45; 0.0.46 demonstrably fails Aseprite header validation in the conversion matrix.

**Remaining limits:** unrelated high/moderate/low dependency warnings are not claimed fixed. No broad claim of vulnerability-free dependencies is made. A green CI run and PDF/browser/desktop compatibility checks are required before publication; real desktop/host acceptance remains separate.

---

## What's new in 3.5.5

A small footer-navigation and release-documentation patch. The conversion engine and MCP runtime are unchanged.

- **Cross-link:** frogConvert now links to frogQuiz from its existing footer, styled like the neighboring docs link (#156).
- **Navigation:** the external frogQuiz link opens in a new tab with `noopener noreferrer`, while internal docs navigation stays in the same tab (#157).
- **Documentation:** README and AI plugin guidance now direct readers to the latest GitHub release, preserving the v3.5.4 distinctions between portable Claude workspace skills and native local MCP executables (#156).

Claude workspace import, local-host ChatGPT support, and real-client MCP execution are not established by a published ZIP or passing CI. Installers and native plugin packages require the release workflow's own verification.

---

## What's new in 3.5.4

A Claude workspace-upload packaging fix, without changes to the conversion engine.

- **New:** `frogconvert-claude-workspace-v3.5.4.zip` contains a root Claude plugin manifest and four portable skills, with no bundled executable or unusable local MCP configuration. It can guide workflows but cannot itself convert files.
- **Unchanged native capability:** Windows, macOS Intel/Apple Silicon and Linux Claude Code and ChatGPT binary ZIPs are still built and checksum-verified as separate local-host candidates.
- **Cheaper CI:** packaging PRs run fast Python archive checks; full native platform probes remain available manually and still run for publication in the release workflow.

Actual Claude workspace upload must still be tested in the UI. ChatGPT desktop local-MCP permission, local security, and full host acceptance remain open. Do not mistake a valid ZIP or MCP smoke test for an approved installation.

---

## What's new in 3.5.3

A compatibility and dependency maintenance release after v3.5.2. No new hosted conversion service or additional local file privileges.

- TypeScript 7.0.2 with narrow source compatibility fixes for legacy handler types and DOM APIs (#117).
- Routine Bun dependency refresh, keeping ImageMagick WASM at 0.0.45 because 0.0.46 failed the Aseprite converter regression (#150).
- GitHub Actions updates and synced Claude development guidance (#136, #148).

Main-branch CI is green. Desktop platform installers, actual Claude/ChatGPT host execution and the separate PDF.js viewer scripting advisory remain distinct release/acceptance obligations. This release does not claim to fix or verify them.

---

## What's new in 3.5.2

Security patches for the TOON decoder and the PDF fallback path, a repaired audit command, and the footer and CI fixes shipped since 3.5.1.

- The `.toon` decoder now uses `@toon-format/toon` 2.3.1, with a regression test for prototype-like keys.
- When Ghostscript is unavailable, PDF canvas rendering no longer evaluates scripts (`isEvalSupported: false`).
- The Bun audit script runs as `bun audit --audit-level=high`.
- The FPE credit in the footer is 9px and baseline-aligned.

Not changed by this release: the separate PDF.js viewer scripting advisory, the live Content-Security-Policy headers, and real-host installation of the Claude and ChatGPT plugins. Those remain open items.

---

## What's new in 3.5.1

The existing native Claude/ChatGPT packaging safety fixes now ship with frogConvert's established 512px application icon, matched listing/composer branding, consistent plugin metadata and a canonical compatibility manifest. No additional file privileges or hosted conversion service are introduced.

The release workflow now builds native Claude and ChatGPT plugin ZIPs on Linux x64, Windows x64 and macOS (ARM64/x64), checks archive digests, and attaches the platform-specific candidates alongside desktop installers. Native MCP smoke tests do not establish that ChatGPT Desktop accepts local executors; install and host approval remain independent.

---

## What's new in 3.5.0

**Version-aligned 3.5 baseline for native AI plugin candidates.**

The local-first AI plugin packages now have native MCP smoke and packaging checks on Linux x64, Windows x64, macOS Intel and macOS Apple Silicon. The archive builder includes the project's GPL license, upstream GPLv2 license and copyright notices; regression checks cover both source plugin versions and the shipped notices.

The **ChatGPT desktop package remains an engineering candidate, not a supported installation or public download**. OpenAI approval is still required for local MCP execution, and clean-host installation, full native/WASM conversion coverage, and remaining filesystem race and Windows reparse-point risks still require acceptance. This release does not change the main browser converter's processing architecture or expose an upload service.

Previous release: [v3.4.11](https://github.com/ogfrench/frogConvert/releases/tag/v3.4.11). Full history in [CHANGELOG.md](https://github.com/ogfrench/frogConvert/blob/master/CHANGELOG.md).

---

## About frogConvert

frogConvert is a universal file converter, compressor and PDF editor that runs entirely in your browser. Convert between 70+ formats, compress images, audio, video and PDFs, or edit PDFs, all without a single byte leaving your machine, and drive the same engine from AI agents and scripts through the MCP server or the local REST API.

### Convert anything to anything
- 70+ file formats across images, audio, video, documents and more.
- A routing engine (shortest path over the format graph) chains conversions automatically, so it can get from A to B even when there is no direct converter, picking the best route for you.

### Compress without losing what matters
- A dedicated Compress mode for images, audio, video and PDFs, with per-file savings shown before you download.
- Real PDF compression via Ghostscript-WASM: text stays text, not rasterized into an image.
- Never worse: a re-encode that saves less than 2% is discarded and you keep the original.

### Built-in PDF editor
- Merge, reorder, extract pages, and watermark PDFs, all in the same tool.

### Private by design
- Everything runs client-side in the browser. Files are never uploaded to a server, so nothing is stored, logged, or sent anywhere.

### For agents and scripts
- MCP server: clone the repo and run `bun run mcp`, exposing conversion, compression and PDF editing as tools to AI agents.
- Local REST API: `bun run api`, the same engine behind a simple HTTP interface for scripts and automation.

### Run it your way
- Use it in the browser, self-host it, run it in Docker, or build it as a desktop app.

### Built on
- TypeScript, Vite, and a Vitest + Puppeteer test suite.
- Ghostscript, ImageMagick, FFmpeg, Pandoc, pdf-lib and pdf.js do the heavy lifting; the full list is in the README.
- A fork of "Convert to it!" by p2r3, whose conversion pipeline frogConvert inherits and builds on. **Compress and the PDF editor are frogConvert originals**, neither exists upstream, as are the MCP server, the REST API and the test suite.

### No warranty
frogConvert is provided as is, with no warranty and no security audit. See [SECURITY.md](https://github.com/ogfrench/frogConvert/blob/master/SECURITY.md).

