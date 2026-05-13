/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { CacheFirst, StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { clientsClaim } from "workbox-core";
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

registerRoute(
  ({ url }) => url.pathname.startsWith("/assets/"),
  new StaleWhileRevalidate({
    cacheName: "assets-v1",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 30 * 24 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  })
);

registerRoute(
  ({ url }) => url.pathname.startsWith("/js/"),
  new StaleWhileRevalidate({ cacheName: "js-runtime-v1" })
);

registerRoute(
  ({ url }) => url.pathname.startsWith("/docs/") && url.pathname.endsWith(".md"),
  new StaleWhileRevalidate({ cacheName: "docs-md-v1" })
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
