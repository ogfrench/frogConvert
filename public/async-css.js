// Applies the stylesheets that the `async-css` build plugin turned into
// preloads (see vite.config.js).
//
// This used to be an `onload="this.onload=null;this.rel='stylesheet'"`
// attribute on each link. That is an inline event handler, which no Content
// Security Policy can allow without `unsafe-inline`, and it was two of the
// eight violations measured when the shipped policy was tested as enforcing.
//
// Deferred on purpose: a deferred script runs after the document is parsed and
// before DOMContentLoaded, so every link exists by the time this runs and there
// is no race with a preload that finished early. Nothing here is on the
// first-paint path - the reveal is gated on `--background` becoming readable,
// not on this file.
for (const link of document.querySelectorAll("link[data-async-css]")) {
    link.rel = "stylesheet";
}
