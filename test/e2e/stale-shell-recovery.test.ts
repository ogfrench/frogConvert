// @vitest-environment node
//
// The empirical test for the bug this branch fixes: a returning user whose
// service worker holds the previous build must still get a working app after a
// deploy. Everything else about the fix is unit-tested; only this exercises the
// real generated service worker, the real precache manifest, and a real
// Chromium doing a real second visit.
//
// Shape of the run:
//   1. Produce a production build (the SW only exists in one).
//   2. Serve it, load it, wait for the SW to take control - a first-time user.
//   3. Derive a second deploy: every hashed asset gets a new hash, the old URLs
//      stop existing. Point the server at it.
//   4. Reload. The old SW is still installed and still serving its precache.
//
// Before the fix, step 4 produced a fully rendered page with no JavaScript
// bound to it: index.html was precached, the entry chunk it named was not, and
// the SPA fallback answered the missing chunk with 200 text/html.
//
// What this proves, and what it does not. Reverting `assets/*.js` out of
// globPatterns in vite.config.js makes the first test here fail, so the
// precache half of the fix is genuinely pinned. The browser-level tests are
// weaker evidence: the recovery handlers can rescue a broken shell, and the
// production triggers for an absent chunk - 258 chunks competing for 200 LRU
// slots, a 30-day TTL, a route never visited - cannot be reproduced inside a
// minute, which is why the reload below clears the runtime cache by hand. Read
// them as "a returning user across a deploy ends up with a live app", not as a
// direct reproduction of the original dead UI.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import puppeteer, { Browser, Page } from "puppeteer";
import { build } from "vite";
import path from "path";
import fs from "fs";
import os from "os";
import { hasFullRegistry, MISSING_DEPS_REASON } from "../helpers/optionalDeps.ts";

/**
 * Opt-in, the same way the corpus suites are (see test/helpers/corpus.ts).
 *
 * This file runs a full production build and drives Chromium: 62 seconds on its
 * own, in a worker parallel with every other test file. On a two-core CI runner
 * that contention is enough to push the MCP integration suite past the SDK's
 * 60-second request timeout - which is exactly what happened on the merge to
 * master, on a tree that had passed the identical suite minutes earlier.
 *
 * Gating it costs less than it looks. The invariant that actually matters -
 * every script a precached HTML file names is itself precached - is asserted at
 * BUILD time by the manifestTransform in vite.config.js, so `bun run build`
 * fails in CI without this file running at all. What is gated here is the
 * browser-level confirmation, which is worth running deliberately:
 *
 *     bun run test:shell
 */
const shellE2eRequested = process.env.FROG_E2E_SHELL === "1";
const SKIP_REASON = !shellE2eRequested
  ? "opt-in: set FROG_E2E_SHELL=1, or run `bun run test:shell`"
  : MISSING_DEPS_REASON;
import { startDeployServer, deriveNextDeploy, type DeployServer } from "../helpers/staticDeploy.ts";

const ROOT = path.resolve(__dirname, "../../");

/** Wait for a page predicate, returning false rather than throwing on timeout. */
async function settles(page: Page, fn: string, timeout = 30_000): Promise<boolean> {
  try {
    await page.waitForFunction(fn, { timeout, polling: 250 });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasFullRegistry || !shellE2eRequested)(
  `E2E stale-shell recovery [${SKIP_REASON}]`,
  () => {
    let workDir: string;
    let deployA: string;
    let deployB: string;
    let server: DeployServer;
    let browser: Browser;
    let page: Page;

    beforeAll(async () => {
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), "frog-shell-"));
      deployA = path.join(workDir, "deploy-a");
      deployB = path.join(workDir, "deploy-b");

      // Built straight into this test's own directory, never the shared dist/.
      // vitest runs test files in parallel workers, and test/e2e/electron-app
      // builds too: with both writing dist/, whichever substituted the CSP
      // placeholder in _headers first made the other fail the build outright.
      // Every plugin that writes output now honours the resolved outDir, which
      // is what makes this possible.
      await build({
        configFile: path.join(ROOT, "vite.config.js"),
        root: ROOT,
        logLevel: "silent",
        build: { outDir: deployA, emptyOutDir: true, sourcemap: false },
      });

      deriveNextDeploy(deployA, deployB);

      server = await startDeployServer(deployA);
      browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      page = await browser.newPage();
    }, 600_000);

    afterAll(async () => {
      await browser?.close();
      await server?.close();
      if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
    });

    it("precaches the entry chunk the built HTML names", () => {
      // The invariant, read off the real artifacts rather than the config.
      const sw = fs.readFileSync(path.join(deployA, "sw.js"), "utf8");
      const precached = new Set(
        [...sw.matchAll(/"url":\s*"([^"]+)"/g)].map((m) => m[1])
      );
      const html = fs.readFileSync(path.join(deployA, "index.html"), "utf8");
      const referenced = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)]
        .map((m) => m[1]);

      expect(referenced.length).toBeGreaterThan(0);
      for (const url of referenced) expect(precached).toContain(url);
    });

    it("boots for a first-time visitor and installs a controlling SW", async () => {
      await page.goto(`${server.url}/`, { waitUntil: "networkidle2", timeout: 60_000 });

      expect(await settles(page, "() => window.__frogShellBooted === true")).toBe(true);

      // Asserted, not assumed. Everything below is about what a *controlled*
      // navigation is served, so if the worker never takes over the remaining
      // tests would pass having exercised nothing. Registration is timing
      // sensitive (workbox-window defers to the load event unless told
      // otherwise), and it does not take control at all under some headless
      // Chromium builds - so this failing means the harness is wrong, not
      // necessarily the app.
      expect(
        await settles(page, "() => navigator.serviceWorker.controller !== null", 60_000)
      ).toBe(true);

      // `controller !== null` is the weaker of the two conditions and lands at
      // a different moment from `activated`. Both are needed before the deploy
      // skew below means anything: a worker still installing serves nothing, so
      // the reload would go to the network, fetch the *new* deploy's HTML, and
      // sail through - a pass that exercised none of this. That is what the
      // suite was doing most of the time, and why it failed only sometimes:
      // measured, the fourth test reproduces its own scenario exactly when the
      // worker happens to have activated first.
      expect(
        await settles(page, `async () => {
          const r = await navigator.serviceWorker.getRegistration();
          return !!(r && r.active && r.active.state === "activated");
        }`, 120_000)
      ).toBe(true);

      // One more load, on the same deploy, so the page under test is one the
      // worker actually served. The first visit never is: it is the navigation
      // that registered the worker.
      await page.reload({ waitUntil: "networkidle2", timeout: 60_000 });
      expect(await settles(page, "() => window.__frogShellBooted === true")).toBe(true);
      expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    }, 180_000);

    it("serves a 404, not an HTML fallback, for a chunk the deploy removed", async () => {
      server.setRoot(deployB);
      const gone = await page.evaluate(async (origin) => {
        // Bypass the SW so this measures the host, not the cache.
        const res = await fetch(`${origin}/assets/definitely-not-here-00000000.js`, {
          cache: "no-store",
        });
        return { status: res.status, type: res.headers.get("content-type") };
      }, server.url);

      // The old behaviour was 200 text/html, which is what poisoned the cache.
      expect(gone.status).toBe(404);
      expect(gone.type ?? "").not.toContain("text/html");
    });

    it("still boots after a deploy replaced every hashed asset", async () => {
      // deployB is live (set in the previous test). The SW installed against
      // deployA is still the controller and still holds deployA's precache.
      //
      // Drop the runtime cache first. In production the entry chunk is absent
      // from it for three routine reasons - 258 chunks competing for 200 LRU
      // slots, the old 30-day TTL, or simply a route never visited - and none
      // of those reproduce inside a 60-second test. Without this the first
      // visit's copy is still sitting in assets-v2 and answers the stale HTML,
      // so the run would pass no matter how the precache was configured.
      // Clearing it is what makes the precache the only thing holding the
      // shell together, which is the condition the fix is about.
      // Best-effort: with the fix in place the shell comes from the precache,
      // so the runtime cache may never have been created at all. Its absence is
      // itself the point, so this must not assert on the delete's result.
      await page.evaluate(() => caches.delete("assets-v2"));
      // A marker left by an earlier phase would be read below as this phase's
      // doing. Cleared so the count means what it says.
      await page.evaluate(() => sessionStorage.removeItem("frogconvert:stale-shell-reload"));

      // Every 404 the boot produces, so the assertion below can ask *which*
      // URLs went missing rather than whether the app noticed.
      const missing: string[] = [];
      const onResponse = (r: { status: () => number; url: () => string }) => {
        if (r.status() === 404) missing.push(new URL(r.url()).pathname.replace(/^\//, ""));
      };
      page.on("response", onResponse);

      await page.reload({ waitUntil: "networkidle2", timeout: 60_000 });

      const booted = await settles(page, "() => window.__frogShellBooted === true", 60_000);
      expect(booted).toBe(true);

      // Liveness, not just paint. `app-ready` is also added by a 15s safety net
      // in index.html, so it proves nothing on its own - this is app state that
      // only real module execution produces.
      const alive = await settles(
        page,
        "() => window.supportedFormatCache instanceof Map && window.supportedFormatCache.size > 0",
        60_000
      );
      expect(alive).toBe(true);

      page.off("response", onResponse);

      // The invariant, stated as what the shell actually promises. "The app
      // works" alone would pass with the precache misconfigured, because the
      // recovery handlers rescue a broken shell either way. So the question is
      // not whether anything 404'd - plenty does, and by design: 247 lazy
      // chunks live in the runtime cache, which this test just deleted, and
      // boot reaches for several of them (the PDF workspace warm-up, the
      // background handler registry). The question is whether anything the
      // *precache* is responsible for went missing. Nothing may, ever: that is
      // the whole of the fix, and it is exactly what failed in 3.0.0, where
      // index.html was precached and the entry chunk it names was not.
      //
      // Measured on this build: 20 lazy chunks 404, no precached URL does.
      const sw = fs.readFileSync(path.join(deployA, "sw.js"), "utf8");
      const precached = new Set(
        [...sw.matchAll(/"url":\s*"([^"]+)"/g)].map((m) => m[1])
      );
      const shellMisses = missing.filter((url) => precached.has(url));
      expect(shellMisses).toEqual([]);

      // And the self-heal is bounded. The lazy-chunk 404s above do trigger it -
      // one purge and one reload, which is the designed answer to a stale
      // shell - but the cooldown must hold it to one. A loop here would be the
      // worse failure of the two: a page that reloads forever.
      const reloads = await page.evaluate(
        () => Number(sessionStorage.getItem("frogconvert:stale-shell-reload")) || 0
      );
      expect(reloads === 0 || Date.now() - reloads < 180_000).toBe(true);
      expect(await settles(page, "() => window.__frogShellBooted === true", 30_000)).toBe(true);
    }, 180_000);

    it("never stored an HTML body under a script URL", async () => {
      // The poisoning check. A 200 text/html cached under a .js key survives
      // reloads forever, because the URL is hashed and never re-requested.
      const poisoned = await page.evaluate(async () => {
        const bad: string[] = [];
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          for (const req of await cache.keys()) {
            if (!/\.(js|mjs|css)(\?|$)/.test(new URL(req.url).pathname)) continue;
            const res = await cache.match(req);
            if (!res) continue;
            const body = (await res.clone().text()).slice(0, 200).trimStart();
            if (body.toLowerCase().startsWith("<!doctype html")) bad.push(`${name} :: ${req.url}`);
          }
        }
        return bad;
      });

      expect(poisoned).toEqual([]);
    }, 120_000);
  }
);
