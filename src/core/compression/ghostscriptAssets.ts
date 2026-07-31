/**
 * Where the Ghostscript payload lives. Its own module because three unrelated
 * places need the URL - the handler that loads it, the preloader that warms it,
 * and the build step that copies it there - and a copied string literal in
 * three files is a broken deploy waiting to happen.
 *
 * vite.config.js copies the package's files here verbatim (see the
 * vite-plugin-static-copy block); the path must match.
 */
export const GS_BASE = "/wasm/gs";

/** The ~16 MB binary. Everything else in the directory is loader glue. */
export const GS_WASM_URL = `${GS_BASE}/gs.wasm`;
