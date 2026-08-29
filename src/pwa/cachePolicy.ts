// Cacheability rules shared by the service worker's runtime routes and its
// precache. Kept out of sw.ts so they can be unit-tested without a
// ServiceWorkerGlobalScope.

/**
 * Whether a URL is one where an HTML body is the legitimate answer.
 *
 * Document URLs end in `.html` or in a slash (the precache carries
 * `index.html`, `docs/index.html` and ~120 generated `.../index.html` SEO
 * pages). Everything else - a hashed `.js` chunk, a `.md` doc, a `.wasm`
 * blob - has a non-HTML extension, and HTML arriving under one of those is the
 * SPA fallback answering for a file the deploy has deleted.
 */
export function expectsHtml(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url, "http://localhost").pathname;
  } catch {
    // Unparseable: treat as a non-document URL, which is the safe direction -
    // it only ever refuses a cache write.
    return false;
  }
  return pathname.endsWith("/") || pathname.toLowerCase().endsWith(".html");
}

/**
 * Refuse to cache an SPA-fallback HTML body under a URL that should not carry
 * one.
 *
 * Both hosting configs answer an unknown path with the SPA fallback, and on a
 * static host a chunk deleted by the previous deploy *is* an unknown path. The
 * response is a 200 carrying index.html, and Workbox's default cacheability
 * check (`cacheOkAndOpaquePlugin`) looks only at the status - so the HTML got
 * written into the runtime cache keyed by the .js URL and stayed there,
 * poisoning that URL until the user cleared site data.
 *
 * The URL check is not optional. This plugin also guards the precache, and 125
 * of its ~165 entries are HTML documents; a content-type test alone rejects
 * every one of them, `precacheAndRoute` rejects its install promise with
 * `bad-precaching-response`, and the service worker never activates at all -
 * which leaves a returning user on whatever worker they already had.
 *
 * The 404 rules in netlify.toml and docker/nginx/default.conf stop the poisoning
 * at the source; this is the second line of defence for any other deployment.
 *
 * Returning null tells Workbox not to cache the response. The response is still
 * passed through to the page, which fails the import and triggers the recovery
 * in staleShell.ts (or the inline handler from src/pwa/bootRecovery.js on a
 * boot failure).
 */
export function isCacheableAsset(response: Response, url?: string): boolean {
  if (response.status !== 200) return false;
  const type = (response.headers.get("Content-Type") || "").toLowerCase();
  if (!type.includes("text/html")) return true;
  // An HTML body is only acceptable where HTML is what the URL names.
  return url !== undefined && expectsHtml(url);
}

export const rejectHtmlFallback = {
  cacheWillUpdate: async (
    { request, response }: { request?: Request; response: Response }
  ): Promise<Response | null> => {
    // Prefer the request URL over response.url: the latter is empty for a
    // constructed Response and follows redirects, while the request is the URL
    // the entry will actually be keyed under.
    const url = request?.url ?? (response.url || undefined);
    if (!isCacheableAsset(response, url)) {
      console.warn(
        `[sw] refusing to cache a ${response.status} ` +
        `${response.headers.get("Content-Type") || "untyped"} body under ${url ?? "an unknown URL"}`
      );
      return null;
    }
    return response;
  },
};
