import { resolve, relative } from "path";
import fs from "fs";
import { createHash } from "crypto";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { VitePWA } from "vite-plugin-pwa";
import tsconfigPaths from "vite-tsconfig-paths";

import { execSync, spawn } from "child_process";

/**
 * Auto-spawn the API server (src/api/index.ts) as a child process on dev
 * startup. This lets the browser UI proxy to /api/* and reach Node-only
 * handlers (e.g. libreoffice, which shells out to soffice) without requiring
 * the developer to manage a second terminal.
 *
 * Skips spawning if port 3000 is already serving /health - useful when the
 * developer runs `bun run api` manually for debugging.
 */
function apiServerPlugin() {
  let apiProcess = null;
  return {
    name: 'api-server',
    apply: 'serve',  // dev mode only
    async configureServer(server) {
      // Probe existing API server first - skip spawn if already running.
      // Verify it's actually a frogConvert API (not some unrelated service
      // happening to answer /health with 200) by checking the body shape.
      try {
        const resp = await fetch('http://127.0.0.1:3000/health', {
          signal: AbortSignal.timeout(500)
        });
        if (resp.ok) {
          const body = await resp.json().catch(() => null);
          if (body && Array.isArray(body.handlers)) {
            console.log('[api-server] existing frogConvert /health responded; reusing instance on port 3000');
            return;
          }
          console.warn('[api-server] port 3000 answered /health but not with frogConvert marker; spawning our own on a fresh process');
        }
      } catch { /* nothing listening, spawn our own */ }

      apiProcess = spawn('bun', ['run', 'src/api/index.ts'], {
        stdio: ['ignore', 'inherit', 'inherit'],
        env: { ...process.env, PORT: '3000' },
        shell: process.platform === 'win32',  // Windows needs shell to resolve "bun"
      });

      apiProcess.on('error', (err) => {
        console.warn('[api-server] failed to spawn:', err.message);
      });

      const cleanup = () => {
        if (apiProcess && !apiProcess.killed) {
          apiProcess.kill();
          apiProcess = null;
        }
      };
      server.httpServer?.once('close', cleanup);
      process.once('exit', cleanup);
      process.once('SIGINT', () => { cleanup(); process.exit(0); });
      process.once('SIGTERM', () => { cleanup(); process.exit(0); });
    },
  };
}

const isDesktopBuild = process.env.IS_DESKTOP === 'true';

const projectPkg = JSON.parse(fs.readFileSync("./package.json", "utf-8"));
const commitSha = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: 'pipe', encoding: 'utf8' }).trim();
  } catch (e) {
    // Log the error for debugging purposes during development, but don't fail the build.
    console.warn("Could not determine git commit SHA. Defaulting to 'dev'. Error:", e.message);
    return 'dev';
  }
})();

export default defineConfig({
  appType: 'mpa',
  define: {
    'import.meta.env.VITE_APP_NAME': JSON.stringify(projectPkg.productName || "frogConvert"),
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(new Date().toISOString()),
    'import.meta.env.VITE_COMMIT_SHA': JSON.stringify(commitSha),
    'import.meta.env.VITE_IS_DESKTOP': JSON.stringify(isDesktopBuild),
    'import.meta.env.VITE_NAV_DOCS': (() => {
      const docs = [];
      const scanDir = (dir) => {
        if (!fs.existsSync(dir)) return;
        fs.readdirSync(dir).forEach(file => {
          if (file.endsWith('.md')) {
            const content = fs.readFileSync(resolve(dir, file), 'utf-8');
            // Support both YAML frontmatter (---) and HTML comment frontmatter (<!-- docs-frontmatter ... -->)
            const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/) ||
              content.match(/^<!--\s*docs-frontmatter\r?\n([\s\S]*?)\r?\n-->/);
            if (fmMatch) {
              const fm = {};
              fmMatch[1].split(/\r?\n/).forEach(line => {
                const [key, ...val] = line.split(':');
                if (key && val.length) fm[key.trim()] = val.join(':').trim();
              });
              if (fm.label) {
                docs.push({ 
                  file, 
                  icon: fm.icon || '📝', 
                  label: fm.label, 
                  desc: fm.desc || '' 
                });
              }
            }
          }
        });
      };
      
      scanDir(__dirname); // Root (README.md)
      scanDir(resolve(__dirname, 'docs'));
      
      // De-duplicate by filename (prioritize root version) and sort
      const uniqueDocs = [];
      const seen = new Set();
      // Put README first, then others alphabetically
      const sorted = docs.sort((a, b) => {
        const aIsReadme = a.file === 'README.md';
        const bIsReadme = b.file === 'README.md';
        if (aIsReadme && bIsReadme) return 0;
        if (aIsReadme) return -1;
        if (bIsReadme) return 1;
        return a.label.localeCompare(b.label);
      });
      
      sorted.forEach(d => {
        if (!seen.has(d.file)) {
          uniqueDocs.push(d);
          seen.add(d.file);
        }
      });

      return JSON.stringify(uniqueDocs);
    })(),
  },
  resolve: {
    // Force top-level copies; d3-sankey nests d3-array which nests internmap without exports field
    dedupe: ['internmap'],
  },
  build: {
    sourcemap: true,
    target: "esnext",
    // Vendor chunks (vexflow ~1.1 MB, font ~1.2 MB, docs/mermaid ~1.6 MB, three.js ~720 KB)
    // are already lazy-loaded as separate chunks; further splitting yields no user-visible
    // benefit. Raise the warning ceiling so legitimate vendor weight isn't reported as a
    // problem on every build.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        docs: resolve(__dirname, "docs/index.html"),
        headless: resolve(__dirname, "headless/index.html"),
      },
      // Desktop build skips vite-plugin-pwa (Electron runs from app:// where
      // a service worker is useless). Without the plugin, the `virtual:pwa-register`
      // module is unresolvable. Mark it external so Rollup leaves the dynamic
      // import as-is; the runtime guard in src/pwa/registerSW.ts ensures we
      // never actually execute it in a desktop bundle.
      ...(isDesktopBuild ? { external: ["virtual:pwa-register"] } : {}),
    },
  },
  worker: {
    format: "es",
  },
  test: {
    globals: true,
    environment: 'jsdom',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Submodule tests - run by the submodule's own test suite, not ours
      'src/handlers/terraria-wld-parser/**',
      'src/handlers/gimper/**',
    ],
    setupFiles: ['./test/setup.ts'],
    testTimeout: 20000,
    // WASM modules (7z-wasm, ImageMagick, etc.) accumulate memory in fork
    // workers that V8 cannot reclaim.  Recycle workers before they OOM.
    vmMemoryLimit: '1gb',
  },
  optimizeDeps: {
    exclude: [
      "@ffmpeg/ffmpeg",
      "@sqlite.org/sqlite-wasm",
      "@bokuweb/zstd-wasm",
      "d3-sankey"
    ],
    include: [
      "internmap"
    ]
  },
  base: "/",
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      }
    }
  },
  plugins: [
    {
      name: 'spa-fallback',
      configureServer(server) {
        // Returning a function runs this AFTER Vite's built-in static file serving,
        // so real files (JS, CSS, WASM, etc.) are still served normally.
        return () => {
          server.middlewares.use((req, res, next) => {
            const url = (req.url || '').split('?')[0];
            if (!url.includes('.') && !url.startsWith('/docs/') && !url.startsWith('/headless/')) {
              req.url = '/index.html';
            }
            next();
          });
        };
      }
    },
    apiServerPlugin(),
    {
      name: 'async-css',
      transformIndexHtml: {
        order: 'post',
        handler(html, { filename }) {
          // Only apply to the main page - docs/headless use DOMContentLoaded and can't handle async CSS.
          if (filename.includes('/docs/') || filename.includes('/headless/')) return html;
          // Convert render-blocking <link rel="stylesheet"> for built assets to async pattern.
          // The FOUC prevention script polls for --background via rAF, so async CSS is safe.
          // The flip to rel="stylesheet" is done by /async-css.js rather than an
          // inline `onload` attribute. An inline handler cannot be allowed by any
          // CSP without `unsafe-inline`, and it accounted for two of the eight
          // violations measured when the shipped policy was tested as enforcing.
          const out = html.replace(
            /<link rel="stylesheet" crossorigin href="(\/assets\/[^"]+\.css)">/g,
            '<link rel="preload" href="$1" as="style" data-async-css>' +
            '<noscript><link rel="stylesheet" href="$1"></noscript>'
          );
          // Only pay for the script on pages that actually got a preload.
          return out.includes('data-async-css')
            ? out.replace('</head>', '  <script src="/async-css.js" defer></script>\n</head>')
            : out;
        }
      }
    },
    {
      /**
       * Write a sha256 for every inline <script> that ships into the CSP.
       *
       * The two inline blocks in index.html cannot simply become files: the
       * first applies `.dark` before the first paint, so an external script
       * adds a round trip and can reintroduce the white flash it exists to
       * prevent. Hashes keep them inline and still let the policy name them.
       * Nonces are the other option and need per-request server generation,
       * which a static host does not do.
       *
       * Hashes are computed from the FINAL files in dist/ rather than during
       * transformIndexHtml, because a hash that does not match the shipped
       * bytes is worse than no hash: it looks correct and blocks the script.
       */
      name: 'csp-hashes',
      apply: 'build',
      closeBundle() {
        const outDir = resolve(__dirname, 'dist');
        const headers = resolve(outDir, '_headers');
        if (!fs.existsSync(headers)) return;

        const hashes = new Set();
        const walk = (dir) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = resolve(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.html')) collect(full);
          }
        };
        const collect = (file) => {
          const html = fs.readFileSync(file, 'utf8');
          const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
          let m;
          while ((m = re.exec(html))) {
            const attrs = m[1];
            // Only inline, executable scripts are hashable. A `src` script is
            // covered by 'self'; ld+json is data and is never executed.
            if (/\bsrc\s*=/.test(attrs)) continue;
            if (/type\s*=\s*["'](?!module|text\/javascript)/.test(attrs)) continue;
            const body = m[2];
            if (!body.trim()) continue;
            hashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
          }
        };
        walk(outDir);

        const list = [...hashes].join(' ');
        const before = fs.readFileSync(headers, 'utf8');
        if (!before.includes('__CSP_SCRIPT_HASHES__')) {
          this.warn('csp-hashes: no __CSP_SCRIPT_HASHES__ placeholder in _headers; leaving it alone');
          return;
        }
        fs.writeFileSync(headers, before.replace('__CSP_SCRIPT_HASHES__', list));
        this.info(`csp-hashes: wrote ${hashes.size} inline-script hash(es)`);
      }
    },
    {
      name: 'markdown-server',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url.endsWith('.md')) {
            const urlPath = req.url.replace(/^\//, '').split('?')[0];
            
            // Map /docs/*.md requests to their file locations
            // If it's in /docs/, check if it's there or at project root
            let filePath;
            if (urlPath.startsWith('docs/')) {
              const filename = urlPath.slice('docs/'.length);
              const rootPath = resolve(__dirname, filename);
              const docsPath = resolve(__dirname, 'docs', filename);

              // Prioritize file at root (README.md, etc) if it exists, otherwise check docs/
              filePath = fs.existsSync(rootPath) ? rootPath : docsPath;

              // Path traversal protection: ensure the resolved file is within the project root.
              // Uses relative() rather than startsWith() to handle case-insensitive filesystems (Windows).
              const rel = relative(__dirname, filePath);
              if (rel.startsWith('..')) {
                next();
                return;
              }
            } else {
              filePath = resolve(__dirname, urlPath);
              const rel = relative(__dirname, filePath);
              if (rel.startsWith('..')) {
                next();
                return;
              }
            }

            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
              res.setHeader('Content-Type', 'text/markdown');
              res.end(fs.readFileSync(filePath));
              return;
            }
          }
          next();
        });
      }
    },
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/@flo-audio/reflo/reflo_bg.wasm",
          dest: "wasm"
        },
        {
          src: "node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.*",
          dest: "wasm"
        },
        {
          src: "node_modules/@imagemagick/magick-wasm/dist/magick.wasm",
          dest: "wasm"
        },
        {
          src: "src/handlers/pandoc/pandoc.wasm",
          dest: "wasm"
        },
        // Ghostscript ships as a directory, not a single wasm: gs.mjs imports
        // ./browser.js and ./gs.js by relative path at runtime. Copying the set
        // verbatim (rather than bundling) keeps those relative imports working
        // and is the only loading path verified to initialise - see
        // scripts/ghostscript-smoke.mjs. LICENSE travels with it because
        // Ghostscript is AGPL-3.0.
        {
          src: "node_modules/@jspawn/ghostscript-wasm/gs.mjs",
          dest: "wasm/gs"
        },
        {
          src: "node_modules/@jspawn/ghostscript-wasm/gs.js",
          dest: "wasm/gs"
        },
        {
          src: "node_modules/@jspawn/ghostscript-wasm/browser.js",
          dest: "wasm/gs"
        },
        {
          src: "node_modules/@jspawn/ghostscript-wasm/gs.wasm",
          dest: "wasm/gs"
        },
        {
          src: "node_modules/@jspawn/ghostscript-wasm/LICENSE",
          dest: "wasm/gs"
        },
        {
          src: "src/handlers/libopenmpt/libopenmpt.wasm",
          dest: "wasm"
        },
        {
          src: "src/handlers/libopenmpt/libopenmpt.js",
          dest: "wasm"
        },
        {
          src: "node_modules/js-synthesizer/externals/libfluidsynth-2.4.6.js",
          dest: "wasm"
        },
        {
          src: "node_modules/js-synthesizer/dist/js-synthesizer.js",
          dest: "wasm"
        },
        {
          src: "src/handlers/midi/TimGM6mb.sf2",
          dest: "wasm"
        },
        {
          src: "src/handlers/espeakng.js/js/espeakng.worker.js",
          dest: "js"
        },
        {
          src: "src/handlers/espeakng.js/js/espeakng.worker.data",
          dest: "js"
        },
        // Auto-sync all documentation files
        { src: "*.md", dest: "docs" },
        { src: "docs/*.md", dest: "docs" },
        { src: "LICENSE", dest: "docs" },
        {
          src: "node_modules/pdf-parse/dist/pdf-parse/web/pdf.worker.mjs",
          dest: "js"
        },
        {
          src: "src/handlers/tarCompressed/liblzma.wasm",
          dest: "wasm"
        },
        {
          src: "node_modules/turbowarp-packager-browser/dist/scaffolding/*",
          dest: "js/turbowarp-scaffolding"
        },
        {
          src: "node_modules/7z-wasm/7zz.wasm",
          dest: "wasm"
        }
      ]
    }),
    // SW + manifest only for the web build. Desktop runs from app:// where
    // a service worker would be both useless and a registration footgun.
    !isDesktopBuild && VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      strategies: 'injectManifest',
      srcDir: 'src/pwa',
      filename: 'sw.ts',
      includeAssets: [
        'favicon.ico',
        'frog-emoji.webp',
        'social-preview.png',
        'robots.txt',
        'apple-touch-icon-180.png'
      ],
      manifest: {
        name: 'frogConvert - convert files privately in your browser',
        short_name: 'frogConvert',
        description: 'Convert 70+ file formats, compress images, audio and video, and edit or shrink PDFs, all in your browser. Nothing is uploaded.',
        start_url: '/',
        scope: '/',
        id: '/',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        orientation: 'any',
        lang: 'en',
        dir: 'ltr',
        categories: ['productivity', 'utilities'],
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/apple-touch-icon-180.png', sizes: '180x180', type: 'image/png' }
        ],
        screenshots: [
          { src: '/pwa-screenshot-narrow.png', sizes: '640x1136', type: 'image/png', form_factor: 'narrow' },
          { src: '/pwa-screenshot-wide.png', sizes: '1920x1080', type: 'image/png', form_factor: 'wide' }
        ],
        // OS integration: "Open with frogConvert" + share-target. Mirror the converter's
        // input formats; entry handler in src/main.ts reads launchQueue / share POST.
        file_handlers: [
          {
            action: '/',
            accept: {
              'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.heic', '.heif', '.svg', '.avif'],
              'video/*': ['.mp4', '.mov', '.webm', '.mkv', '.avi'],
              'audio/*': ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.midi', '.mid'],
              'application/pdf': ['.pdf'],
              'text/*': ['.txt', '.md', '.csv', '.json', '.xml', '.yaml', '.yml', '.html'],
              'application/zip': ['.zip'],
              'application/x-7z-compressed': ['.7z']
            }
          }
        ],
        share_target: {
          action: '/?share-target=1',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [{ name: 'file', accept: ['*/*'] }]
          }
        },
        launch_handler: { client_mode: 'navigate-existing' }
      },
      injectManifest: {
        // Precache only entry HTMLs, CSS, registry, icons, fonts. JS chunks
        // are runtime-cached (see src/pwa/sw.ts) so the SW install doesn't
        // pre-pull 17 MB of lazy handler code before the user does anything.
        globPatterns: [
          '*.{html,ico,webp,png,svg,json,txt,woff2}',
          '**/index.html',
          'assets/*.css'
        ],
        globIgnores: [
          '**/wasm/**',
          '**/js/turbowarp-scaffolding/**',
          '**/*.sf2',
          '**/docs/*.md',
          // Format-handler precache. main.ts fetches it dynamically and
          // caches it in localStorage; precaching here would pin users to
          // stale handler signatures across deploys until they manually
          // clear site data.
          'cache.json'
        ],
        maximumFileSizeToCacheInBytes: 2 * 1024 * 1024
      },
      devOptions: { enabled: false }
    }),
    tsconfigPaths()
  ]
});
