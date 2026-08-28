/*
 * Inlined verbatim into the <head> of every HTML entry by the `boot-recovery`
 * plugin in vite.config.js. Not a module, not bundled, no imports: it has to run
 * in exactly the case where the app bundle did NOT load, so it cannot depend on
 * anything the bundler produces.
 *
 * Every asset URL is content-hashed, so a deploy replaces the whole set. A
 * returning user holding cached HTML that names the previous build's chunks gets
 * a 404 - or, on a host whose SPA fallback answers first, a 200 of text/html
 * that a module script refuses on MIME grounds. Either way the browser fires
 * `error` on the <script>/<link>, nothing else runs, and the page sits there
 * fully rendered but bound to nothing.
 *
 * Scope is deliberately BOOT ONLY. src/pwa/staleShell.ts takes over the moment
 * the app is alive, and it handles lazy-chunk failures the right way. If this
 * listener stayed armed it would also catch the `<link rel="modulepreload">`
 * elements Vite appends for lazily imported chunks, and a transient network
 * blip mid-conversion would purge caches and reload, destroying queued files
 * and in-flight results. It would also win the shared reload claim, leaving
 * staleShell.ts unable to suppress the generic error popup.
 *
 * Three things are kept in sync with src/pwa/staleShell.ts, asserted by a test
 * there: the sessionStorage key, the cooldown, and the set of caches purged.
 */
(function () {
  var MARKER = "frogconvert:stale-shell-reload";
  var COOLDOWN_MS = 300000;
  var recovering = false;

  function isShellCache(name) {
    return name.indexOf("workbox-precache") === 0
      || name === "assets-v1"
      || name === "assets-v2"
      || name === "js-runtime-v1"
      || name === "docs-md-v1";
  }

  function claimReload() {
    try {
      var previous = Number(sessionStorage.getItem(MARKER));
      if (previous > 0 && Date.now() - previous < COOLDOWN_MS) return false;
      sessionStorage.setItem(MARKER, String(Date.now()));
      return true;
    } catch (e) {
      // No session memory means no loop guard, and an unguarded reload is
      // worse than a broken page. Decline.
      return false;
    }
  }

  // Capture phase: resource load errors do not bubble.
  window.addEventListener("error", function (e) {
    // The app booted, so this is not a failed boot. staleShell.ts owns it.
    if (window.__frogShellBooted) return;
    if (recovering) return;

    var el = e.target;
    if (!el || el === window) return;
    if (el.tagName !== "SCRIPT" && el.tagName !== "LINK") return;
    var url = el.src || el.href;
    if (!url || url.indexOf("/assets/") === -1) return;
    // Offline is not a stale shell, and reloading cannot fix it.
    if (navigator.onLine === false) return;
    if (!claimReload()) {
      console.warn("[boot] asset failed again within the cooldown, not reloading");
      return;
    }
    recovering = true;
    console.warn("[boot] shell asset failed to load, purging caches and reloading:", url);

    // Drop only the caches that can hold a stale shell, then reload from the
    // network. wasm-v1 (~17 MB of engines at content-stable URLs) and the
    // share-target cache are left alone; neither is implicated here, and
    // clearing the latter would silently drop files a share is handing over.
    // localStorage is untouched too: format registry, theme, saved session.
    var jobs = [];
    try {
      if (window.caches) {
        jobs.push(caches.keys().then(function (names) {
          return Promise.all(names.filter(isShellCache).map(function (n) {
            return caches.delete(n);
          }));
        }));
      }
      if (navigator.serviceWorker) {
        jobs.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
          return Promise.all(regs.map(function (r) { return r.unregister(); }));
        }));
      }
    } catch (err) { /* fall through to the reload regardless */ }

    Promise.all(jobs)["catch"](function (err) {
      console.warn("[boot] purge failed, reloading anyway:", err);
    }).then(function () { location.reload(); });
  }, true);
})();
