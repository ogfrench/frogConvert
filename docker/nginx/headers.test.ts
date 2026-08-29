// nginx's add_header does not merge across configuration levels: a location
// that declares ANY add_header of its own drops every header inherited from
// the server block. That is easy to reintroduce by adding one Cache-Control to
// a location and not noticing the CSP left with it, and the symptom - a
// security header quietly missing from one path in a Docker deployment - shows
// up in a header dump, not in any test.
//
// So assert the structural rule instead: every location that adds a header of
// its own must also include the shared security snippet.
//
// Scope: this reads default.conf as text and never asks nginx whether the
// file is even valid. Syntax and socket binding are covered by the `nginx`
// job in .github/workflows/ci.yml, which runs `nginx -t` against the same
// nginx:stable-alpine image the Dockerfile runtime stage uses. Neither
// check subsumes the other: nginx accepts a location that silently drops
// the CSP, and this file cannot spot a typo'd directive.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const CONF = readFileSync(resolve(__dirname, "default.conf"), "utf8");
const SNIPPET_PATH = "/etc/nginx/snippets/security-headers.conf";

interface Block { header: string; body: string }

/**
 * Split the server block into its top-level `location` blocks.
 *
 * Throws rather than guessing if the file stops matching its assumptions.
 * A parser that silently merges two blocks would let a location with an
 * add_header and no include hide inside a neighbour that has one, and the
 * suite would stay green while the container served that path with no CSP -
 * the exact regression this file exists to catch.
 */
function locationBlocks(conf: string): Block[] {
  const blocks: Block[] = [];
  const re = /^\s{4}(location\s[^{]*)\{$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(conf))) {
    // Locations here are never nested, so the next line at the same indent
    // closing the brace ends the block.
    const start = re.lastIndex;
    const end = conf.indexOf("\n    }", start);
    if (end === -1) {
      throw new Error(
        `unterminated location block ${m[1].trim()}: no closing brace at 4-space ` +
        `indent. Reindented, nested, or CRLF-checked-out config?`
      );
    }
    blocks.push({ header: m[1].trim(), body: conf.slice(start, end) });
  }
  const declared = conf.match(/^\s*location\s/gm)?.length ?? 0;
  if (blocks.length !== declared) {
    throw new Error(
      `parsed ${blocks.length} location blocks but the file declares ${declared}; ` +
      `the parser is out of step with the config's formatting`
    );
  }
  return blocks;
}

describe("docker/nginx/default.conf", () => {
  const blocks = locationBlocks(CONF);

  it("parses out the location blocks", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(8);
  });

  it("includes the security snippet at server level", () => {
    // Everything before the first location block.
    const serverLevel = CONF.slice(0, CONF.indexOf("    location"));
    expect(serverLevel).toContain(`include ${SNIPPET_PATH};`);
  });

  it("has locations that declare their own add_header, which is the risky case", () => {
    expect(blocks.filter((b) => /^\s*add_header/m.test(b.body)).length).toBeGreaterThan(0);
  });

  it.each(
    // Only the blocks that would drop the inherited headers need the include.
    blocks
      .filter((b) => /^\s*add_header/m.test(b.body))
      .map((b) => [b.header, b.body] as const)
  )("%s declares add_header, so it re-includes the security snippet", (_header, body) => {
    expect(body).toContain(`include ${SNIPPET_PATH};`);
  });

  it("404s build output instead of falling through to the SPA rule", () => {
    // The SPA fallback answering a deleted chunk with 200 index.html is what
    // let the service worker cache HTML under a .js URL.
    for (const prefix of ["/assets/", "/js/"]) {
      const block = blocks.find((b) => b.header.includes(prefix));
      expect(block, `no location block for ${prefix}`).toBeDefined();
      expect(block!.body).toContain("=404");
    }
    const wasm = blocks.find((b) => b.header.includes("/wasm/"));
    expect(wasm!.body).toContain("=404");
  });

  it("still ends with the SPA fallback", () => {
    const fallback = blocks.at(-1);
    expect(fallback!.header).toBe("location /");
    expect(fallback!.body).toContain("try_files $uri $uri/ /index.html;");
  });
});

describe("the snippet path contract with the Dockerfile", () => {
  it("copies the snippet to exactly the path default.conf includes", () => {
    // A mismatch here does not drop a header, it stops nginx booting at all
    // ("open() ... failed"), which every test in this file would still pass.
    const dockerfile = readFileSync(resolve(__dirname, "../Dockerfile"), "utf8");
    expect(dockerfile).toMatch(
      new RegExp(`^COPY\\s+docker/nginx/security-headers\\.conf\\s+${SNIPPET_PATH}\\s*$`, "m")
    );
  });
});

describe("docker/nginx/security-headers.conf", () => {
  const SNIPPET = readFileSync(resolve(__dirname, "security-headers.conf"), "utf8");

  it.each([
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "Content-Security-Policy",
  ])("carries %s", (header) => {
    expect(SNIPPET).toMatch(new RegExp(`^add_header ${header}\\b`, "m"));
  });

  it("marks every header `always`, so they survive error responses too", () => {
    // Without `always`, nginx omits add_header on 4xx/5xx - including the
    // =404s this config now returns for missing build output.
    const directives = SNIPPET.match(/^add_header .*/gm) ?? [];
    expect(directives.length).toBeGreaterThan(0);
    for (const d of directives) expect(d.trimEnd()).toMatch(/ always;$/);
  });

  it("is a bare snippet, with no server or location wrapper", () => {
    // It is spliced into both levels; a block here would be a syntax error.
    expect(SNIPPET).not.toMatch(/^\s*(server|location|http)\s*[^;]*\{/m);
  });
});
