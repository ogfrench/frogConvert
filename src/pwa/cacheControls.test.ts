import { describe, it, expect } from "vitest";
import { formatCacheBytes, sumCacheBytes } from "./cacheControls";

describe("formatCacheBytes", () => {
  it("renders bytes under 1 KiB as B", () => {
    expect(formatCacheBytes(0)).toBe("0 B");
    expect(formatCacheBytes(512)).toBe("512 B");
    expect(formatCacheBytes(1023)).toBe("1023 B");
  });

  it("renders KB", () => {
    expect(formatCacheBytes(1024)).toBe("1 KB");
    expect(formatCacheBytes(1024 * 150)).toBe("150 KB");
  });

  it("renders MB with one decimal", () => {
    expect(formatCacheBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatCacheBytes(55 * 1024 * 1024)).toBe("55.0 MB");
  });

  it("renders GB with two decimals for very large caches", () => {
    expect(formatCacheBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.50 GB");
  });
});

describe("sumCacheBytes", () => {
  it("sums Content-Length headers when present", async () => {
    const responses = [
      new Response("ignored", { headers: { "Content-Length": "1024000" } }),
      new Response("ignored", { headers: { "Content-Length": "2048000" } }),
    ];
    const total = await sumCacheBytes(responses);
    expect(total).toBe(3072000);
  });

  it("falls back to blob size when Content-Length is missing", async () => {
    const responses = [
      new Response("a".repeat(500)),
      new Response("b".repeat(1500)),
    ];
    const total = await sumCacheBytes(responses);
    expect(total).toBe(2000);
  });

  it("returns 0 for empty input", async () => {
    expect(await sumCacheBytes([])).toBe(0);
  });
});
