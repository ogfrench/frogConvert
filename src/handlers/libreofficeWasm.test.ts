import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CommonFormats from "../core/CommonFormats/CommonFormats.ts";
import LibreOfficeHandler from "./libreoffice.ts";

const office = vi.hoisted(() => ({
  cached: vi.fn(async () => true),
  open: vi.fn(),
}));

vi.mock("../core/officeEngine/officeEngine.ts", () => ({
  isOfficeEngineCached: office.cached,
  openOfficeEngine: office.open,
}));

const XLSX = CommonFormats.XLSX.builder("xlsx").allowFrom();
const PDF = CommonFormats.PDF.builder("pdf").allowTo();
const output = new Uint8Array([37, 80, 68, 70]);

function converter(convert: () => Promise<{ data: Uint8Array }>) {
  return {
    initialize: vi.fn(async () => {}),
    convert: vi.fn(convert),
    destroy: vi.fn(async () => {}),
  };
}

async function handler() {
  // Exercise browser WASM mode rather than the native soffice probe in Vitest.
  const nativeProcess = globalThis.process;
  vi.stubGlobal("process", undefined);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
  try {
    const instance = new LibreOfficeHandler();
    await instance.init();
    expect(instance.ready).toBe(true);
    return instance;
  } finally {
    vi.stubGlobal("process", nativeProcess);
  }
}

describe("browser Office worker recovery", () => {
  beforeEach(() => {
    office.open.mockReset();
    office.cached.mockResolvedValue(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("terminates a stalled small-document worker before retrying once", async () => {
    const first = converter(() => new Promise(() => {}));
    const second = converter(async () => ({ data: output }));
    office.open.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const instance = await handler();
    vi.useFakeTimers();
    const progress: string[] = [];
    const pending = instance.doConvert(
      [{ name: "sample.xlsx", bytes: new Uint8Array(256) }], XLSX, PDF, undefined,
      p => { if (p.detail) progress.push(p.detail); },
    );
    await vi.advanceTimersByTimeAsync(25_000);
    await expect(pending).resolves.toMatchObject([
      { name: "sample.pdf", bytes: output },
    ]);
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(office.open).toHaveBeenCalledTimes(2);
    expect(second.convert).toHaveBeenCalledOnce();
    expect(progress).toContain("Restarting Office engine (one retry)...");
  });

  it("never repeats a large document after a watchdog timeout", async () => {
    const first = converter(() => new Promise(() => {}));
    office.open.mockResolvedValueOnce(first);
    const instance = await handler();
    vi.useFakeTimers();
    const pending = instance.doConvert(
      [{ name: "large.xlsx", bytes: new Uint8Array(2_000_001) }], XLSX, PDF,
    );
    // The 2 MB input selects the 45-second watchdog.
    const failure = expect(pending).rejects.toThrow(/took longer than 45 seconds/);
    await vi.advanceTimersByTimeAsync(45_000);
    await failure;
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(office.open).toHaveBeenCalledOnce();
  });

  it("does not retry when the failed worker cannot be stopped", async () => {
    const first = converter(() => new Promise(() => {}));
    first.destroy.mockRejectedValue(new Error("Worker termination unconfirmed"));
    office.open.mockResolvedValueOnce(first);
    const instance = await handler();
    vi.useFakeTimers();
    const pending = instance.doConvert(
      [{ name: "sample.xlsx", bytes: new Uint8Array(128) }], XLSX, PDF,
    );
    const failure = expect(pending).rejects.toThrow(/Worker termination unconfirmed/);
    await vi.advanceTimersByTimeAsync(25_000);
    await failure;
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(office.open).toHaveBeenCalledOnce();
  });

  it("fails explicitly after a second timeout, never silently rasterizing", async () => {
    const first = converter(() => new Promise(() => {}));
    const second = converter(() => new Promise(() => {}));
    office.open.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const instance = await handler();
    vi.useFakeTimers();
    const pending = instance.doConvert(
      [{ name: "sample.xlsx", bytes: new Uint8Array(128) }], XLSX, PDF,
    );
    const failure = expect(pending).rejects.toThrow(/took longer than 25 seconds/);
    await vi.advanceTimersByTimeAsync(50_000);
    await failure;
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(second.destroy).toHaveBeenCalledOnce();
    expect(office.open).toHaveBeenCalledTimes(2);
  });
});
