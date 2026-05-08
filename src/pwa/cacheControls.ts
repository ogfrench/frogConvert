// User-facing cache size helpers. The SW caches WASM, runtime JS, docs, etc.;
// `cacheControls` lets settings UIs report total bytes and offer a clear
// action without requiring intimate knowledge of the cache names.

/**
 * Format a byte count into a short human-readable string.
 * Renders B / KB / MB / GB depending on magnitude. KB and B are integer-only
 * (sub-decimal precision is noise at those sizes); MB carries one decimal,
 * GB two so multi-GB caches don't all display as "2 GB".
 */
export function formatCacheBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  if (bytes < KB) return `${Math.round(bytes)} B`;
  if (bytes < MB) return `${Math.floor(bytes / KB)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / GB).toFixed(2)} GB`;
}

/**
 * Sum the size of an iterable of cached responses. Prefers Content-Length
 * (cheap, no body copy) and falls back to materialising the blob for
 * responses without the header (e.g. opaque cross-origin entries).
 */
export async function sumCacheBytes(responses: Iterable<Response>): Promise<number> {
  let total = 0;
  for (const resp of responses) {
    const header = resp.headers.get('Content-Length');
    if (header) {
      const n = Number(header);
      if (Number.isFinite(n) && n >= 0) {
        total += n;
        continue;
      }
    }
    try {
      const blob = await resp.clone().blob();
      total += blob.size;
    } catch {
      // Opaque or unreadable - skip rather than aborting the whole sum.
    }
  }
  return total;
}

/**
 * Walk every Cache Storage cache the SW manages and return its total bytes.
 * Returns 0 in environments without Cache Storage (SSR, restricted contexts).
 */
export async function getTotalCacheBytes(): Promise<number> {
  if (typeof caches === 'undefined') return 0;
  let total = 0;
  try {
    const names = await caches.keys();
    for (const name of names) {
      const cache = await caches.open(name);
      const requests = await cache.keys();
      const responses: Response[] = [];
      for (const req of requests) {
        const r = await cache.match(req);
        if (r) responses.push(r);
      }
      total += await sumCacheBytes(responses);
    }
  } catch (err) {
    console.warn('[cacheControls] getTotalCacheBytes failed:', err);
  }
  return total;
}

/**
 * Delete every Cache Storage cache. Returns the names of caches that were
 * cleared. Used by a "Clear cached app data" settings affordance.
 */
export async function clearAllCaches(): Promise<string[]> {
  if (typeof caches === 'undefined') return [];
  try {
    const names = await caches.keys();
    await Promise.all(names.map(name => caches.delete(name)));
    return names;
  } catch (err) {
    console.warn('[cacheControls] clearAllCaches failed:', err);
    return [];
  }
}
