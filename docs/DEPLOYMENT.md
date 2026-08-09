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
bunx frogconvert api
PORT=8080 bunx frogconvert api
```

> **First-run note.** The npm package bundles `pandoc.wasm` (~55 MB uncompressed, ~12 MB compressed download) for document conversion. `bunx` caches this after the first run.

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

## Environment variables

| Variable | Default | Applies to | Description |
|---|---|---|---|
| `PORT` | `3000` | REST API | Port the HTTP server binds to. |
| `MAX_UPLOAD_MB` | `4096` | MCP + REST API | Max input file size in MB. Files over this are rejected before conversion. |

## See also

- [INTEGRATIONS.md](INTEGRATIONS.md) - MCP + REST API usage.
- [../AGENTS.md](../AGENTS.md) - contributor and agent rules.
- [ARCHITECTURE.md](ARCHITECTURE.md) - internal design.
