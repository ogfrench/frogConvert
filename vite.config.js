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
  },
  optimizeDeps: {
    exclude: [
      "@ffmpeg/ffmpeg",
      "@sqlite.org/sqlite-wasm",
    ]
  },
  base: "/convert/",
  plugins: [
    {
      name: 'markdown-server',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url.endsWith('.md')) {
            const urlPath = req.url.replace(/^\/convert\//, '').split('?')[0];
            
            // Map /docs/*.md requests to their file locations
            // If it's in /docs/, check if it's there or at project root
            let filePath;
            if (urlPath.startsWith('docs/')) {
              const filename = urlPath.replace('docs/', '');
              const rootPath = resolve(__dirname, filename);
              const docsPath = resolve(__dirname, 'docs', filename);
              
              // Path traversal protection: ensure the file is within root or docs
              if (!rootPath.startsWith(__dirname) && !docsPath.startsWith(__dirname)) {
                next();
                return;
              }

              // Prioritize file at root (README.md, etc) if it exists, otherwise check docs/
              filePath = fs.existsSync(rootPath) ? rootPath : docsPath;
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
        { src: "docs/*.md", dest: "docs" }
      ]
    }),
    tsconfigPaths()
  ]
});
