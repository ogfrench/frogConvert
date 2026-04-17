<!-- docs-frontmatter
icon: 🔒
label: Security
desc: Privacy posture, limits, responsible disclosure
-->

# Security and Privacy

frogConvert's central promise is **client-side processing**. This document states the guarantee precisely, lists what that guarantee does not cover, and explains how to report security issues.

## Privacy guarantee

**All file conversion and PDF editing runs locally on your device.** Files are never uploaded to a server operated by this project. The web app at [frogconvert.xyz](https://frogconvert.xyz) is served as static assets plus WebAssembly; after it loads, no outbound requests for your files are made.

Specifically:

- **No cloud conversion.** Every handler is a WASM module or browser API running in your browser tab or in a Web Worker.
- **No telemetry.** No analytics, no crash reporting, no usage beacons.
- **No server uploads for conversion.** The MCP and REST API, when you run them locally with `bunx frogconvert mcp` or `bunx frogconvert api`, listen only on `127.0.0.1` by default. Files you pass in never leave the machine the server runs on.
- **Fonts.** Inter is self-hosted with Google Fonts as a fallback. The fallback request transmits referer/IP per normal HTTP behavior; it does not transmit file content.

## Known limits and caveats

- **Safari PDF input** is limited. See [docs/CONVERTER.md § Known limitations](docs/CONVERTER.md#known-limitations).
- **Encrypted PDFs.** Password-protected PDFs are not supported by the editor. Remove the password with another tool first.
- **Browser bridge (server mode).** If you run the REST API or MCP with a production build present, some conversions fall back to a Puppeteer-launched headless Chromium running locally. That is still on your machine, but it does spawn a real browser process. See [INTEGRATIONS.md § Browser-Assisted Conversions](docs/INTEGRATIONS.md#browser-assisted-conversions-automatic-fallback).
- **Third-party mirrors and forks.** The privacy guarantee applies to the official hosted site and the source in this repository. If you use a fork, a mirror, or a self-hosted copy, verify the deployment has not been modified to add uploads or telemetry.
- **Local disk.** When using the REST API with `filePath` or `outputFilePath`, the server reads and writes files on your local disk. It is your responsibility to handle those paths (permissions, deletion) appropriately. Set `FROGCONVERT_SANDBOX_ROOT` to an absolute directory to constrain those arguments to that root as defense-in-depth. The API also rejects cross-origin requests via `Origin` / `Host` header validation, so a browser page you visit cannot POST to your locally-running server.

## Scope of this document

Out of scope: security of dependencies shipped inside the browser (pdf-lib, pdfjs-dist, FFmpeg.wasm, ImageMagick.wasm, etc.). Those are upstream projects with their own security practices; we pin versions in `package.json` and upgrade as advisories arrive.

## Reporting a vulnerability

Please report suspected vulnerabilities privately before opening a public issue. Open a GitHub Security Advisory against [ogfrench/frogConvert](https://github.com/ogfrench/frogConvert), or email the maintainer listed in [package.json](package.json) `author`.

Please include:

- A description of the issue and its impact.
- Steps to reproduce (URL or commit SHA, browser, OS).
- Whether the issue affects the hosted site, the self-hosted build, the MCP server, the REST API, or the desktop build.

You will receive an acknowledgement within a week. Fixes ship in a follow-up release noted in [CHANGELOG.md](CHANGELOG.md).

## See also

- [docs/CONVERTER.md](docs/CONVERTER.md) and [docs/PDF_EDITOR.md](docs/PDF_EDITOR.md) - end-user feature docs.
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) - programmatic access surfaces.
- [CHANGELOG.md](CHANGELOG.md) - security-relevant release notes.
