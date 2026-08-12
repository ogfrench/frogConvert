<!-- docs-frontmatter
icon: 🔒
label: Security
desc: What this thing does and doesn't do
-->

# Security and privacy

## What this is, and what it is not

frogConvert is a hobby project, maintained in spare time, and it is provided
**as is**. There is no warranty of any kind - not of merchantability, not of
fitness for a particular purpose, and not of security. Sections 15 to 17 of the
[GPLv3](LICENSE) are the operative terms; this paragraph is the plain-English
version, not a replacement for them.

Concretely, that means:

- **No guarantee your files survive.** The engines are third-party WASM builds
  of large, complicated software. They have bugs. Keep your originals - the app
  is deliberately built never to overwrite an input, but do not make it the only
  copy of anything you care about.
- **No security guarantees, and no audit.** Nobody has paid for a penetration
  test or a code audit of this, and none has been done. The privacy properties
  below are real and are how the thing is designed, but they are described
  honestly rather than certified.
- **No SLA, no bug bounty, no commitment to fix anything.** Reports are welcome
  and taken seriously; see below. Nothing is promised about when, or whether, a
  given issue is addressed.
- **Not for anything where being wrong is expensive.** If you are handling
  regulated, legally sensitive or safety-critical documents, use software that
  carries an assurance someone will stand behind.

Anyone is free to use, study, modify and redistribute it under the GPLv3. The
absence of a warranty is part of what makes that possible.


## What happens to your files

All conversion runs on your device, in the browser tab, in a Web Worker, with WebAssembly. The site at frogconvert.xyz serves static files plus WASM; once that lands, your files don't go anywhere else.

A few specifics:

- Every handler is a WASM module or a browser API. There's no server-side conversion path at all.
- No analytics, telemetry, crash reporters, or usage beacons. None of it.
- `bunx frogconvert mcp` talks over stdio (no network port). `bunx frogconvert api` binds to `127.0.0.1:3000` only and rejects cross-origin requests via Origin/Host header validation. Files passed in stay on the machine running the server.
- Inter is bundled via `@fontsource-variable/inter`. If it doesn't load for some reason, the browser falls back to system fonts. No requests go to Google Fonts or any other font CDN.
- The PWA service worker caches files in your browser. You can clear it from the browser's site-data UI or via the in-app cache controls.
- Files dropped into the Converter, the PDF Editor **or Compress** get saved to IndexedDB so the Resume prompt can offer them back. Compress stores the chosen level alongside them. They auto-purge after 7 days; clearing site data wipes them right away.

## Limits worth knowing

- Safari struggles with some PDFs. See [docs/CONVERTER.md § Known limitations](docs/CONVERTER.md#known-limitations).
- Password-protected PDFs aren't supported. Strip the password first with another tool.
- When the REST API or MCP runs next to a production build, some conversions fall back to a Puppeteer-launched headless Chromium locally. Still your machine, but a real browser process spawns. See [INTEGRATIONS.md § Browser-Assisted Conversions](docs/INTEGRATIONS.md#browser-assisted-conversions---automatic-fallback).
- The notes above describe this repo and frogconvert.xyz. A fork, mirror, or self-hosted copy is its own thing and could have been modified.
- The REST API and MCP will write to the local disk if given paths. There's no automatic permission check or cleanup. Setting `FROGCONVERT_SANDBOX_ROOT=/some/dir` pins those paths to one root (`src/mcp/core/fileInput.ts`).
- Dependencies are pinned in `package.json`; upstream advisories aren't actively monitored.

Issues and PRs welcome on [GitHub](https://github.com/ogfrench/frogConvert).

## See also

- [docs/CONVERTER.md](docs/CONVERTER.md) and [docs/PDF_EDITOR.md](docs/PDF_EDITOR.md): the user-facing flows.
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md): MCP and REST.
- [CHANGELOG.md](CHANGELOG.md): release history.
