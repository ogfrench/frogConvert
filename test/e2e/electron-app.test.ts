// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
// `puppeteer`, not `puppeteer-core`: only the former is a declared dependency,
// and connect() over an existing DevTools endpoint needs nothing core-specific.
import puppeteer, { type Browser, type Page } from "puppeteer";
import { spawn, type ChildProcess } from "child_process";
import { build } from "vite";
import fs from "fs";
import os from "os";
import path from "path";
import { hasFullRegistry, MISSING_DEPS_REASON } from "../helpers/optionalDeps.ts";

/**
 * The desktop shell, actually launched.
 *
 * Everything else in this suite exercises the app over http://. The Electron
 * build serves it over a custom `app://` protocol with its own hand-written
 * route fallback, its own COOP/COEP header injection and its own file
 * resolution - none of which any other test touches. `app://-/compress`
 * answered "File Not Found" all the way to release sign-off because nothing
 * had ever opened the built artifact.
 *
 * Runs headless via Xvfb. Skips - loudly, with the reason - where either the
 * Electron binary or a virtual framebuffer is missing, because a silent
 * `return` is how the compress e2e stayed red in CI for four runs.
 */
const ROOT = path.resolve(__dirname, "../..");
const ELECTRON_BIN = path.join(ROOT, "node_modules/electron/dist/electron");
const DEBUG_PORT = 9422;

function which(cmd: string): boolean {
    const dirs = (process.env.PATH ?? "").split(path.delimiter);
    return dirs.some(d => d && fs.existsSync(path.join(d, cmd)));
}

const hasElectron = fs.existsSync(ELECTRON_BIN);
const hasXvfb = which("xvfb-run");
const canRun = hasElectron && hasXvfb && hasFullRegistry;
const WHY = !hasFullRegistry ? MISSING_DEPS_REASON
    : !hasElectron ? "electron binary not installed (run `npm rebuild electron`)"
    : "xvfb-run not on PATH";

describe.skipIf(!canRun)(`Electron desktop app [${WHY}]`, () => {
    let proc: ChildProcess;
    let browser: Browser;
    let page: Page;

    beforeAll(async () => {
        // The desktop bundle differs from the web one, and vite.config.js reads
        // the flag from the environment at config-load time - so it has to be
        // set before build(), not passed in as a define.
        process.env.IS_DESKTOP = "true";
        await build({
            configFile: path.resolve(ROOT, "vite.config.js"),
            root: ROOT,
            logLevel: "error",
        });

        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "frog-electron-"));
        proc = spawn("xvfb-run", [
            "-a", "--server-args=-screen 0 1280x800x24",
            ELECTRON_BIN, "--no-sandbox",
            `--user-data-dir=${profile}`,
            `--remote-debugging-port=${DEBUG_PORT}`, ".",
        ], { cwd: ROOT, stdio: "ignore", detached: true });

        // Poll for the DevTools endpoint rather than sleeping a fixed amount.
        const deadline = Date.now() + 90_000;
        for (;;) {
            try {
                browser = await puppeteer.connect({
                    browserURL: `http://127.0.0.1:${DEBUG_PORT}`,
                    defaultViewport: null,
                });
                break;
            } catch (err) {
                if (Date.now() > deadline) throw err;
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        page = (await browser.pages())[0];
    }, 600_000);

    afterAll(async () => {
        await browser?.disconnect();
        try { if (proc?.pid) process.kill(-proc.pid); } catch { /* already gone */ }
    });

    /** Load a route and wait for the app to actually mount on it. */
    async function open(route: string) {
        await page.goto(`app://-/${route}`, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(
            () => document.body.innerText.length > 20,
            { timeout: 60_000 });
    }

    it("serves the SPA on every route the router can produce", async () => {
        for (const route of ["convert", "pdf", "compress"]) {
            await open(route);
            const text = await page.evaluate(() => document.body.innerText);
            expect(text, `app://-/${route} should not 404`).not.toMatch(/File Not Found/i);
        }
    }, 300_000);

    it("lands a deep link on the surface it names", async () => {
        await open("compress");
        const visible = await page.waitForFunction(
            () => {
                const card = document.querySelector("#compress-card");
                return !!card && card.getBoundingClientRect().width > 0;
            },
            { timeout: 60_000 }).catch(() => null);
        expect(visible, "app://-/compress should show the compress card").toBeTruthy();
    }, 300_000);

    it("still serves real assets from disk instead of rewriting them", async () => {
        await open("compress");
        const res = await page.evaluate(async () => {
            const r = await fetch("app://-/cache.json");
            const t = await r.text();
            return { status: r.status, looksLikeJson: /^[[{]/.test(t.trim()), length: t.length };
        });
        expect(res.status).toBe(200);
        expect(res.looksLikeJson, "cache.json must not be rewritten to index.html").toBe(true);
        expect(res.length).toBeGreaterThan(1000);
    }, 120_000);

    it("keeps the primary action a full-width, 44px target inside the shell", async () => {
        await open("compress");
        await page.setViewport({ width: 1280, height: 800 });

        // A real file through the real picker - the app builds its input
        // lazily, so a synthesised change event does not register.
        const jpeg = path.join(os.tmpdir(), `frog-e2e-${Date.now()}.jpg`);
        fs.writeFileSync(jpeg, Buffer.from(await page.evaluate(async () => {
            const c = document.createElement("canvas");
            c.width = 1200; c.height = 800;
            const g = c.getContext("2d")!;
            const grad = g.createLinearGradient(0, 0, 1200, 800);
            grad.addColorStop(0, "#2b6cb0"); grad.addColorStop(1, "#f6ad55");
            g.fillStyle = grad; g.fillRect(0, 0, 1200, 800);
            for (let i = 0; i < 3000; i++) {
                g.fillStyle = `rgba(${(i * 37) % 255},${(i * 91) % 255},${(i * 53) % 255},0.5)`;
                g.fillRect((i * 137) % 1200, (i * 71) % 800, 12, 12);
            }
            return c.toDataURL("image/jpeg", 0.98).split(",")[1];
        }), "base64"));

        const [chooser] = await Promise.all([
            page.waitForFileChooser({ timeout: 30_000 }),
            page.evaluate(() =>
                (document.querySelector("#compress-card .upload-zone") as HTMLElement).click()),
        ]);
        await chooser.accept([jpeg]);

        await page.waitForFunction(() => !!document.querySelector(".cw-compress"), { timeout: 60_000 });
        const geom = await page.evaluate(() => {
            const btn = document.querySelector(".cw-compress")!.getBoundingClientRect();
            const card = document.querySelector("#compress-card")!;
            const cs = getComputedStyle(card);
            const inner = card.getBoundingClientRect().width
                - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
            return { w: btn.width, h: btn.height, inner };
        });

        expect(geom.h).toBeGreaterThanOrEqual(44);
        // Within a couple of px of the card's content box - it is `width: 100%`,
        // so anything else means a stray margin or a border eating the row.
        expect(Math.abs(geom.inner - geom.w)).toBeLessThanOrEqual(2);

        fs.rmSync(jpeg, { force: true });
    }, 600_000);
});
