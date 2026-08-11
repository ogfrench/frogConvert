// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import config from "../vite.config.js";

/**
 * The dev server config, checked for things that must not happen during a test
 * run.
 *
 * `vite.config.js` is the one file in the project that runs in every context -
 * dev, build, and the test runner itself - and the only one where a mistake is
 * invisible because nothing imports it.
 */

interface PluginLike {
    name?: string;
    apply?: string;
    configureServer?: (server: unknown) => unknown;
}

function plugin(name: string): PluginLike {
    const flat = (config.plugins ?? []).flat(Infinity) as PluginLike[];
    const found = flat.find(p => p && p.name === name);
    expect(found, `no plugin named "${name}"`).toBeDefined();
    return found!;
}

afterEach(() => { vi.restoreAllMocks(); });

describe("the api-server plugin", () => {
    /**
     * `apply: 'serve'` reads like "dev only" and is not: Vitest builds a Vite
     * server in serve mode too, so this hook fired on every `vitest run` and
     * spawned a full API server on port 3000 - plus the headless Chromium its
     * bridge warms up - for a suite that wants neither.
     *
     * What it cost, before the guard: a fixed port held for the length of every
     * run, so a second run or a `bun run dev` in another terminal made the
     * child die on EADDRINUSE printing a bare "Fatal error" that reads like a
     * test failure; a Chromium launched per run for nobody; and the "something
     * prevents Vite server from exiting" warning with its 10-second teardown
     * stall on the end of every run. Removing it took a bare test file from
     * 3.96s to 236ms.
     *
     * Detected through `fetch`, because probing port 3000 is the first thing
     * the hook does after the guard - so this goes red the moment the guard
     * stops working, rather than the moment a port happens to be busy.
     */
    it("does not spawn anything when it is the test runner asking", async () => {
        const probe = vi.spyOn(globalThis, "fetch");
        const api = plugin("api-server");

        expect(process.env.VITEST, "this test is meaningless outside vitest").toBeTruthy();
        await api.configureServer!({ httpServer: null });

        expect(probe, "the api-server plugin tried to reach port 3000 during a test run")
            .not.toHaveBeenCalled();
    });

    it("is still restricted to serve mode", () => {
        // The guard above is additional to this, not a replacement for it: a
        // production build must never spawn a server either.
        expect(plugin("api-server").apply).toBe("serve");
    });
});
