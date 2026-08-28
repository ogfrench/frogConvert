// A static host that behaves like the real ones, so a service-worker test can
// actually observe a deploy replacing a build underneath a returning user.
//
// The rules mirror netlify.toml and docker/nginx/default.conf: build output
// 404s when it is missing, everything else falls back to index.html with a 200.
// That fallback is the whole reason this helper exists - a server that 404s
// everything would hide the failure mode the fix is about.

import http from "http";
import fs from "fs";
import path from "path";
import type { AddressInfo } from "net";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/** Prefixes that must 404 rather than fall through to the SPA rule. */
const NO_FALLBACK = ["/assets/", "/js/", "/wasm/"];

export interface DeployServer {
  url: string;
  /** Swap the served build - this is the "deploy" in the test. */
  setRoot(dir: string): void;
  close(): Promise<void>;
}

export async function startDeployServer(initialRoot: string): Promise<DeployServer> {
  let root = initialRoot;

  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);

    // Reject traversal before it reaches the filesystem.
    const resolved = path.resolve(root, "." + urlPath);
    if (!resolved.startsWith(path.resolve(root))) {
      res.writeHead(403).end("forbidden");
      return;
    }

    const send = (file: string, status = 200) => {
      const body = fs.readFileSync(file);
      res.writeHead(status, {
        "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
        "Content-Length": body.length,
        // The SW must never be HTTP-cached, or an update cannot roll out.
        ...(urlPath === "/sw.js" ? { "Cache-Control": "no-cache" } : {}),
      });
      res.end(body);
    };

    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      send(resolved);
      return;
    }

    const asIndex = path.join(resolved, "index.html");
    if (fs.existsSync(asIndex)) {
      send(asIndex);
      return;
    }

    if (NO_FALLBACK.some((prefix) => urlPath.startsWith(prefix))) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }

    send(path.join(root, "index.html"), 200);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    setRoot(dir: string) { root = dir; },
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); }),
  };
}

/**
 * Derive a second deploy from a built one by giving every hashed asset a new
 * hash, rewriting every reference to it, and deleting the originals.
 *
 * This is what the browser sees across a redeploy: the HTML names URLs that no
 * longer exist, and sw.js differs byte-for-byte so a new worker installs. Doing
 * it this way rather than building twice keeps the test to one build while
 * still exercising the real generated service worker and precache manifest.
 */
export function deriveNextDeploy(fromDir: string, toDir: string): Map<string, string> {
  fs.cpSync(fromDir, toDir, { recursive: true });

  const assetsDir = path.join(toDir, "assets");
  const renames = new Map<string, string>();
  for (const name of fs.readdirSync(assetsDir)) {
    // Vite emits <name>-<hash>.<ext>; only the hash segment changes.
    const match = name.match(/^(.*)-([A-Za-z0-9_-]{8})(\.[^.]+(?:\.map)?)$/);
    if (!match) continue;
    const [, base, hash, ext] = match;
    const nextHash = hash.split("").reverse().join("").replace(/[^A-Za-z0-9_-]/g, "x");
    if (nextHash === hash) continue;
    renames.set(`${base}-${hash}${ext}`, `${base}-${nextHash}${ext}`);
  }

  for (const [from, to] of renames) {
    fs.renameSync(path.join(assetsDir, from), path.join(assetsDir, to));
  }

  // Rewrite references everywhere they can appear: HTML, the chunks themselves
  // (dynamic-import maps), and sw.js's precache manifest.
  const rewrite = (file: string) => {
    const original = fs.readFileSync(file, "utf8");
    let updated = original;
    for (const [from, to] of renames) updated = updated.split(from).join(to);
    if (updated !== original) fs.writeFileSync(file, updated);
  };

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(html|js|mjs|css|json|webmanifest)$/.test(entry.name)) rewrite(full);
    }
  };
  walk(toDir);

  return renames;
}
