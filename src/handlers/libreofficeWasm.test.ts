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

/** A worker that answers its warm-up, then does `convert` for the user's file. */
function converter(convert: () => Promise<{ data: Uint8Array }>) {
  const real = vi.fn(convert);
  return {
    initialize: vi.fn(async () => {}),
    real,
    convert: vi.fn((_data: Uint8Array, _options: unknown, name?: string) =>
      name === "warm-up.txt" ? Promise.resolve({ data: output }) : real()),
    destroy: vi.fn(async () => {}),
  };
}

/** A worker that never answers anything, warm-up included. */
function silentWorker() {
  return {
    initialize: vi.fn(async () => {}),
    convert: vi.fn(() => new Promise<{ data: Uint8Array }>(() => {})),
    destroy: vi.fn(async () => {}),
  };
}

let current: LibreOfficeHandler | null = null;

async function handler() {
  // Exercise browser WASM mode rather than the native soffice probe in Vitest.
  const nativeProcess = globalThis.process;
  vi.stubGlobal("process", undefined);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
  try {
    const instance = new LibreOfficeHandler();
    await instance.init();
    expect(instance.ready).toBe(true);
    current = instance;
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
    // A finished conversion leaves the engine idling under a two-minute timer.
    current?.terminate();
    current = null;
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
    expect(second.real).toHaveBeenCalledOnce();
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

  describe("engine warm-up", () => {
    const small = () => [{ name: "sample.xlsx", bytes: new Uint8Array(128) }];

    it("proves a new worker answers before the user's file reaches it", async () => {
      const engine = converter(async () => ({ data: output }));
      office.open.mockResolvedValueOnce(engine);
      const instance = await handler();
      await expect(instance.doConvert(small(), XLSX, PDF)).resolves.toMatchObject([{ bytes: output }]);
      expect(engine.convert.mock.calls.map(c => c[2])).toEqual(["warm-up.txt", "sample.xlsx"]);
      expect(office.open).toHaveBeenCalledOnce();
    });

    it("replaces a worker that is silent through its warm-up, so the user's file meets a working one", async () => {
      const silent = silentWorker();
      const healthy = converter(async () => ({ data: output }));
      office.open.mockResolvedValueOnce(silent).mockResolvedValueOnce(healthy);
      const instance = await handler();
      vi.useFakeTimers();
      const pending = instance.doConvert(small(), XLSX, PDF);
      await vi.advanceTimersByTimeAsync(6_000);
      await expect(pending).resolves.toMatchObject([{ bytes: output }]);
      expect(silent.destroy).toHaveBeenCalledOnce();
      expect(silent.convert).toHaveBeenCalledOnce();
      expect(healthy.real).toHaveBeenCalledOnce();
      expect(office.open).toHaveBeenCalledTimes(2);
    });

    it("gives up replacing after three starts, hands over the last worker, and the watchdog still covers the file", async () => {
      const silents = [silentWorker(), silentWorker(), silentWorker()];
      const healthy = converter(async () => ({ data: output }));
      office.open.mockResolvedValueOnce(silents[0]).mockResolvedValueOnce(silents[1])
        .mockResolvedValueOnce(silents[2]).mockResolvedValueOnce(healthy);
      const instance = await handler();
      vi.useFakeTimers();
      const pending = instance.doConvert(small(), XLSX, PDF);
      // 3 x 6 s of silence (the engine opened instantly, so the minimum); the third worker is used anyway, stalls on the
      // file for the 25 s watchdog, and the one retry gets the healthy worker.
      await vi.advanceTimersByTimeAsync(6_000 * 3 + 25_000);
      await expect(pending).resolves.toMatchObject([{ bytes: output }]);
      expect(silents.map(w => w.destroy.mock.calls.length)).toEqual([1, 1, 1]);
      expect(office.open).toHaveBeenCalledTimes(4);
      expect(healthy.real).toHaveBeenCalledOnce();
    });

    it("keeps a worker that answers the warm-up with an error: it is alive", async () => {
      const engine = converter(async () => ({ data: output }));
      engine.convert.mockImplementationOnce(async () => { throw new Error("no text filter"); });
      office.open.mockResolvedValueOnce(engine);
      const instance = await handler();
      await expect(instance.doConvert(small(), XLSX, PDF)).resolves.toMatchObject([{ bytes: output }]);
      expect(engine.destroy).not.toHaveBeenCalled();
      expect(office.open).toHaveBeenCalledOnce();
    });

    it("never starts another worker when a silent one cannot be stopped", async () => {
      const silent = silentWorker();
      silent.destroy.mockRejectedValue(new Error("Worker termination unconfirmed"));
      office.open.mockResolvedValueOnce(silent);
      const instance = await handler();
      vi.useFakeTimers();
      const pending = instance.doConvert(small(), XLSX, PDF);
      const failure = expect(pending).rejects.toThrow(/could not be stopped safely/);
      await vi.advanceTimersByTimeAsync(6_000);
      await failure;
      expect(office.open).toHaveBeenCalledOnce();
    });
  });
});
