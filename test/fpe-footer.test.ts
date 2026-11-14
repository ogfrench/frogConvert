import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (relative: string) => readFileSync(new URL("../" + relative, import.meta.url), "utf8");

describe("shared footer FPE attribution", () => {
  const source = read("index.html");
  const css = read("src/styles/global.css");

  it("has the approved copy and only one decorative canonical mark", () => {
    expect(source).toContain('designed by <span class="footer-signature">François');
    expect(source).not.toContain("designed with ♥ by François");
    expect(source.match(/data-fpe-mark/g)).toHaveLength(1);
    expect(source).toContain('viewBox="0 0 293 250"');
    expect(source).toContain('d="M0 0H293V148H168V205H293V250H124V148H46V102H124V45H0Z M168 45H249V102H168Z"');
    expect(source).toContain('fill="currentColor"');
    expect(source).toContain('aria-hidden="true"');
  });

  it("keeps the icon adjacent to the name, 9 px tall, baseline-aligned", () => {
    expect(css).toMatch(/\.footer-signature\s*\{[^}]*align-items:\s*baseline/);
    expect(css).toMatch(/\.footer-signature\s*\{[^}]*gap:\s*3px/);
    expect(css).toMatch(/\.footer-fpe-mark\s*\{[^}]*height:\s*9px/);
    expect(css).toMatch(/\.footer-fpe-mark\s*\{[^}]*color:\s*inherit/);
  });
});
