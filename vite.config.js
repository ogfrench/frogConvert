import { resolve } from "path";
import fs from "fs";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import tsconfigPaths from "vite-tsconfig-paths";

import { execSync } from "child_process";

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
  build: {
    sourcemap: true,
    target: "esnext",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        docs: resolve(__dirname, "docs/index.html"),
        headless: resolve(__dirname, "headless/index.html"),
      },
    },
  },
  worker: {
    format: "es",
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    testTimeout: 20000,
  },
  optimizeDeps: {
    exclude: [
      "@ffmpeg/ffmpeg",
      "@sqlite.org/sqlite-wasm",
    ]
  },
  base: "/",
  plugins: [
    {
      name: 'async-css',
      transformIndexHtml: {
        order: 'post',
        handler(html, { filename }) {
          // Only apply to the main page - docs/headless use DOMContentLoaded and can't handle async CSS.
          if (filename.includes('/docs/') || filename.includes('/headless/')) return html;
          // Convert render-blocking <link rel="stylesheet"> for built assets to async pattern.
          // The FOUC prevention script polls for --background via rAF, so async CSS is safe.
          return html.replace(
            /<link rel="stylesheet" crossorigin href="(\/assets\/[^"]+\.css)">/g,
            '<link rel="preload" href="$1" as="style" onload="this.onload=null;this.rel=\'stylesheet\'">' +
            '<noscript><link rel="stylesheet" href="$1"></noscript>'
          );
        }
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
              const filename = urlPath.replace('docs/', '');
              const rootPath = resolve(__dirname, filename);
              const docsPath = resolve(__dirname, 'docs', filename);

              // Prioritize file at root (README.md, etc) if it exists, otherwise check docs/
              filePath = fs.existsSync(rootPath) ? rootPath : docsPath;

              // Path traversal protection: ensure the resolved file is within the project root
              if (!filePath.startsWith(__dirname)) {
                next();
                return;
              }
            } else {
              filePath = resolve(__dirname, urlPath);
              if (!filePath.startsWith(__dirname)) {
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
      ]
    }),
    tsconfigPaths()
  ]
});
