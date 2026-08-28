/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL, addPlugins } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { CacheFirst, StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin, CacheExpiration } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { clientsClaim } from "workbox-core";
import { rejectHtmlFallback } from "./cachePolicy.ts";
import {
  SHARE_TARGET_CACHE,
  SHARE_TARGET_READY_PATH,
  SHARE_TARGET_MAX_FILES,
  SHARE_TARGET_MAX_TOTAL_BYTES,
} from "./shareTargetConstants.ts";

declare const self: ServiceWorkerGlobalScope;

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

cleanupOutdatedCaches();
clientsClaim();

// Runtime caches carrying entries the previous strategy may have poisoned:
// on a miss, the SPA fallback answered 200 text/html and the old cacheability
// check stored it under the requested URL. cleanupOutdatedCaches() only prunes
// Workbox *precaches*, so these have to be named explicitly.
//
// assets-v1 is the renamed predecessor of assets-v2; every URL in it is
// content-hashed, so dropping it costs only a refetch. js-runtime-v1 keeps its
// name but is wiped once, because /js/ URLs are NOT hashed - a poisoned
// pdf.worker.mjs is the live key, and StaleWhileRevalidate serves it stale
// before repairing it, so the first PDF text extraction after activation would
// fail on an HTML body.
//
// wasm-v1 and the share-target cache are deliberately left alone: neither is
// implicated in a shell/chunk mismatch, wasm-v1 holds ~17 MB of engines behind
// content-stable URLs, and the share cache may be holding files a share is
// mid-way through handing over.
const RETIRED_CACHES = ["assets-v1", "js-runtime-v1"];

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all(RETIRED_CACHES.map(async (name) => {
      await caches.delete(name);
      // caches.delete() removes the bucket but not the per-URL rows
      // ExpirationPlugin keeps in IndexedDB, which would otherwise outlive
      // every reference to the cache name.
      await new CacheExpiration(name, { maxEntries: 1 }).delete();
    }))
      .then(() => undefined)
      .catch((err) => { console.warn("[sw] retiring old caches failed:", err); })
  );
});

// The precache is the permanent, versioned cache this whole arrangement rests
// on, and PrecacheStrategy's default cacheability check reads only the status -
// the same check that let an SPA-fallback HTML body be stored under a .js URL.
// A shell chunk answered that way during install would be served as the entry
// script for the entire lifetime of this SW version, and precache entries are
// never revalidated, so it would survive every reload. Guard it too.
addPlugins([rejectHtmlFallback]);

precacheAndRoute(self.__WB_MANIFEST);

// IMPORTANT: register the share-target fetch listener BEFORE Workbox's
// NavigationRoute. Workbox installs its own fetch listener when registerRoute
// is first called; later raw addEventListener calls run *after* it. A multipart
// POST to "/" has request.mode === "navigate" and would be eaten by the
// NavigationRoute (returning the precached /index.html) before our custom
// handler ever sees it.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST") return;
  if (!url.searchParams.has("share-target")) return;
  if (url.pathname !== "/") return;

  event.respondWith(handleShareTarget(event.request));
});

registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api\//, /^\/\.well-known\//, /^\/docs\//, /^\/headless\//],
  })
);

registerRoute(
  ({ url }) => url.pathname.startsWith("/wasm/") || url.pathname.endsWith(".sf2"),
  new CacheFirst({
    cacheName: "wasm-v1",
    plugins: [
      // 200 only. Status 0 (opaque cross-origin) shouldn't appear for our
      // same-origin /wasm/ assets, and accepting it would let a transient
      // CDN error cache an opaque "success" we can't introspect.
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxEntries: 30,
        maxAgeSeconds: 7 * 24 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
    matchOptions: { ignoreVary: true },
  })
);

// Lazy chunks under /assets/ that the precache doesn't carry (see the
// manifestTransform in vite.config.js: entry chunks and their static-import
// closure are precached, everything else lands here).
//
// CacheFirst, not StaleWhileRevalidate: these URLs are content-hashed, so a
// given URL's bytes can never change. Revalidating them spends a network round
// trip per chunk to re-confirm something the hash already guarantees.
//
// No maxAgeSeconds, deliberately. A TTL on immutable assets is a scheduled
// outage: entries expired out from under HTML that still referenced them, and
// the refetch then 404'd because the deploy had moved on. Eviction is by LRU
// alone, and an evicted chunk is simply refetched.
registerRoute(
  ({ url }) => url.pathname.startsWith("/assets/"),
  new CacheFirst({
    cacheName: "assets-v2",
    plugins: [
      rejectHtmlFallback,
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxEntries: 400,
        purgeOnQuotaError: true,
      }),
    ],
  })
);

registerRoute(
  ({ url }) => url.pathname.startsWith("/js/"),
  new StaleWhileRevalidate({
    cacheName: "js-runtime-v1",
    plugins: [rejectHtmlFallback],
  })
);

registerRoute(
  ({ url }) => url.pathname.startsWith("/docs/") && url.pathname.endsWith(".md"),
  new StaleWhileRevalidate({ cacheName: "docs-md-v1", plugins: [rejectHtmlFallback] })
);

async function handleShareTarget(request: Request): Promise<Response> {
  const redirectUrl = new URL(SHARE_TARGET_READY_PATH, self.location.origin).toString();

  // Pre-parse size check: formData() would otherwise materialise the entire
  // multipart body in memory before the post-parse loop has any chance to
  // reject. On low-RAM devices a pathological share OOMs the SW before our
  // caps run. Allow 10% slack for multipart envelope overhead so legit
  // uploads near the cap aren't false-rejected.
  const declaredSize = parseInt(request.headers.get("content-length") || "", 10);
  const earlyCap = Math.floor(SHARE_TARGET_MAX_TOTAL_BYTES * 1.1);
  if (Number.isFinite(declaredSize) && declaredSize > earlyCap) {
    console.warn(`[sw] share-target rejected pre-parse: content-length ${declaredSize} exceeds ~${earlyCap}`);
    return Response.redirect(redirectUrl, 303);
  }

  try {
    // formData() materialises the entire request body. We have to read it
    // before any size check, but we count and reject as we go so a single
    // pathological share doesn't blow past our caps.
    const formData = await request.formData();
    const all = formData.getAll("file").filter((v): v is File => v instanceof File);
    const files: File[] = [];
    let totalBytes = 0;
    let droppedOverLimit = 0;
    for (const f of all) {
      if (files.length >= SHARE_TARGET_MAX_FILES) { droppedOverLimit++; continue; }
      if (totalBytes + f.size > SHARE_TARGET_MAX_TOTAL_BYTES) { droppedOverLimit++; continue; }
      totalBytes += f.size;
      files.push(f);
    }
    if (droppedOverLimit > 0) {
      console.warn(`[sw] share-target dropped ${droppedOverLimit} file(s) over per-file/total/count caps`);
    }

    if (files.length > 0) {
      const cache = await caches.open(SHARE_TARGET_CACHE);
      // Wipe any stale share payload before writing the new one. Without this
      // a previous failed handoff (page killed before extractSharedFilesFromCache)
      // would leak entries into Cache Storage indefinitely.
      const existing = await cache.keys();
      await Promise.all(existing.map(req => cache.delete(req)));

      // Parallel writes: with a multi-file share, sequential cache.put adds up
      // to the user-visible 303-redirect latency. Promise.all lets the SW emit
      // the redirect as soon as the slowest write completes, not their sum.
      const writes: Promise<void>[] = [
        cache.put(
          new Request("__share-payload"),
          new Response(JSON.stringify({
            count: files.length,
            ts: Date.now(),
            dropped: droppedOverLimit,
          }), { headers: { "Content-Type": "application/json" } })
        ),
        ...files.map((f, i) => cache.put(
          new Request(`__share-file-${i}`),
          new Response(f, {
            headers: {
              "Content-Type": f.type || "application/octet-stream",
              "X-Filename": encodeURIComponent(f.name),
            },
          })
        )),
      ];
      await Promise.all(writes);
    }
  } catch (err) {
    console.warn("[sw] share-target POST failed:", err);
  }

  // Absolute URL: Safari has historically rejected relative redirects from
  // service workers with a TypeError.
  return Response.redirect(redirectUrl, 303);
}
