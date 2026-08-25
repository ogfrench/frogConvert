<!-- docs-frontmatter
icon: 🚀
label: Deployment
desc: Self-host, Docker, desktop, CLI
-->

# Deployment

How to run frogConvert somewhere other than [frogconvert.xyz](https://frogconvert.xyz). For programmatic access via MCP or REST, see [INTEGRATIONS.md](INTEGRATIONS.md).

## CLI (no repo clone required)

The MCP server and REST API run directly via `bunx`; no clone or install needed. Requires [Bun](https://bun.sh/).

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

**REST API** (recommended for scripting and automation):

```bash
bun run api
PORT=8080 bun run api
```

> **First-run note.** `pandoc.wasm` is ~55 MB uncompressed and is compiled on first use, which takes 30 s to 3 min. Subsequent runs reuse the compiled module.

See [INTEGRATIONS.md](INTEGRATIONS.md) for request/response shapes, authentication notes, and browser-bridge behavior.

## Local development (Bun + Vite)

1. Clone this repository **with submodules**:

   ```bash
   git clone --recursive https://github.com/ogfrench/frogConvert
   ```

   Omitting submodules leaves you missing a few dependencies.

2. Install [Bun](https://bun.sh/).

3. Install dependencies:

   ```bash
   bun install
   ```

4. Start the dev server:

   ```bash
   bun run dev
   ```

### Optional: pre-build the format cache

When you first open the page, frogConvert generates the list of supported formats per handler. The console complains about missing caches while this runs. Pre-building `public/cache.json` skips that loading screen on future startups; this is also what the production Docker, Netlify, and Electron builds use.

Automated equivalent:

```bash
bun run build && bun run cache:refresh
```

Regenerate the cache after adding, removing, or renaming a handler, or after changing a handler's `supportedFormats`. Manual capture (open the page, wait for `Built initial format list`, then call `printSupportedFormatCache()`) is supported but rarely needed.

For the full mechanism (Puppeteer-driven build step, when to regenerate, dev fallback) see [CONTRIBUTING.md § 4. Cache system](CONTRIBUTING.md#4-cache-system).

## Docker (prebuilt image)

Docker compose files live under `docker/`. Run compose with `-f` from the repo root:

```bash
docker compose -f docker/docker-compose.yml up -d
```

Or download the `docker-compose.yml` alone and run `docker compose up -d` in the same directory.

Runs on `http://localhost:8080/`.

## Docker (local build for development)

Use the override file to build the image locally:

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.override.yml up --build -d
```

The first Docker build is slow because Chromium and related packages are installed in the build stage (needed for Puppeteer in `scripts/buildCache.js`). Later builds are fast thanks to Docker layer caching.

## Desktop app (Electron)

```bash
bun run desktop:start        # build and launch locally
bun run desktop:dist:win     # package for Windows
bun run desktop:dist:mac     # package for macOS
bun run desktop:dist:linux   # package for Linux
```

Native single-binary builds without Electron are available via `bun run compile:win`, `compile:mac`, or `compile:linux`.

## Netlify

A `netlify.toml` at the repo root configures Netlify deployment. Point Netlify at the repo, pick the `main` branch, and default settings will build and deploy the static site.

## Service worker / PWA serving

The web build emits a service worker (`sw.js`) and a Web App Manifest (`manifest.webmanifest`). Serving them with the right headers is non-optional - bad caching pins users to old SW code, and a missing `Service-Worker-Allowed` blocks root-scope registration.

`docker/nginx/default.conf` and `netlify.toml` already set these:

| Path | Header | Why |
|------|--------|-----|
| `/sw.js` | `Cache-Control: public, max-age=0, must-revalidate` | Updates must roll out promptly. |
| `/sw.js` | `Service-Worker-Allowed: /` | Lets the SW be registered with root scope from any path. |
| `/manifest.webmanifest` | `Content-Type: application/manifest+json` | Required by the manifest spec; some browsers reject `text/plain`. |
| `/wasm/*` | `Cache-Control: public, max-age=31536000, immutable` | Content-stable URLs. SW also runtime-caches with a 7-day TTL so critical fixes still propagate within a week. |
| `/index.html`, `/docs/index.html`, `/headless/index.html` | `Cache-Control: public, max-age=0, must-revalidate` | Entry HTMLs reference hashed asset URLs that change every build. Caching them pins users to old asset hashes. |

If you're self-hosting behind a different reverse proxy or CDN, mirror these. The desktop (Electron) build skips the SW entirely (`!isDesktopBuild` gate in `vite.config.js`) so packaged binaries are unaffected.

## Content Security Policy

`public/_headers` carries an **enforced** CSP. It is worth understanding before you self-host, because a CSP failure in this app **hangs rather than errors** - the original measurement had a JPEG compression sitting forever with no message on screen.

Two things are not obvious:

- **`script-src` includes per-script sha256 hashes**, substituted at build time by the `csp-hashes` plugin in `vite.config.js` in place of a `__CSP_SCRIPT_HASHES__` placeholder. Two inline `<script>` blocks have to stay inline - the first applies `.dark` before the first paint, so making it an external file adds a round trip and reintroduces the white flash it exists to prevent. **Serving `public/_headers` verbatim will not work**; serve the built `dist/_headers`, or the inline scripts are blocked.
- **`'unsafe-eval'` is granted deliberately.** Three bundled libraries (`ts-flp`, `font`, `turbowarp`) build functions from strings at init, and `'wasm-unsafe-eval'` does not permit that. The trade was made to get `connect-src 'self'` genuinely enforced, which is what mechanically backs the claim that files never leave the device. The reasoning is recorded in full at the top of `public/_headers`.

Verified by serving the built policy as enforcing and driving Convert, Compress, the PDF Editor and this docs site with real files: **zero violations**. If you change the policy or an inline script, re-run that check rather than trusting the build log - a wrong hash looks correct and silently blocks the script it was meant to allow.

## Environment variables

| Variable | Default | Applies to | Description |
|---|---|---|---|
| `PORT` | `3000` | REST API | Port the HTTP server binds to. |
| `FROGCONVERT_SANDBOX_ROOT` | unset | When set, every `filePath`, `outputFilePath` and `outputDir` an agent passes must resolve inside this directory; relative paths resolve against it and escapes are rejected. Defence in depth for the local API - see [SECURITY.md](../SECURITY.md). |
| `MAX_UPLOAD_MB` | `4096` | MCP + REST API | Max input file size in MB. Files over this are rejected before conversion. |

## See also

- [INTEGRATIONS.md](INTEGRATIONS.md) - MCP + REST API usage.
- [../AGENTS.md](../AGENTS.md) - contributor and agent rules.
- [ARCHITECTURE.md](ARCHITECTURE.md) - internal design.
