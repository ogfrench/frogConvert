// Cacheability rules shared by the service worker's runtime routes.
// Kept out of sw.ts so they can be unit-tested without a ServiceWorkerGlobalScope.

/**
 * Refuse to cache an SPA-fallback HTML body under a non-HTML URL.
 *
 * Both hosting configs answer an unknown path with the SPA fallback, and on a
 * static host a chunk deleted by the previous deploy *is* an unknown path. The
 * response is a 200 carrying index.html, and Workbox's default cacheability
 * check (`cacheOkAndOpaquePlugin`) looks only at the status - so the HTML got
 * written into the runtime cache keyed by the .js URL and stayed there,
 * poisoning that URL until the user cleared site data.
 *
 * The 404 rules in netlify.toml and docker/nginx/default.conf stop this at the
 * source; this is the second line of defence for any other deployment.
 *
 * Returning null tells Workbox not to cache the response. The response is still
 * passed through to the page, which fails the import and triggers the recovery
 * in staleShell.ts (or the inline handler in index.html on a boot failure).
 */
export function isCacheableAsset(response: Response): boolean {
  if (response.status !== 200) return false;
  const type = response.headers.get("Content-Type") || "";
  return !type.toLowerCase().includes("text/html");
}

export const rejectHtmlFallback = {
  cacheWillUpdate: async ({ response }: { response: Response }): Promise<Response | null> => {
    if (!isCacheableAsset(response)) {
      console.warn(
        `[sw] refusing to cache a ${response.status} ` +
        `${response.headers.get("Content-Type") || "untyped"} body under a non-HTML URL`
      );
      return null;
    }
    return response;
  },
};
