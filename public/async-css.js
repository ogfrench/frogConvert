// Compatibility shim. Pages built before stylesheets became plain blocking
// links name this file, and the service worker keeps serving those pages (and
// their precache) until the user accepts the update prompt. Without it the
// request falls through to the SPA fallback, answers text/html, and the old
// shell never turns its preloads into stylesheets: a permanently unstyled app.
// Safe to delete once no deployed shell can still reference it.
for (const link of document.querySelectorAll("link[data-async-css]")) {
    link.rel = "stylesheet";
}
