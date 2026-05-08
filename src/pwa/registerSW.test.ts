import { describe, it, expect } from "vitest";
import { shouldRegisterPwa, type PwaEnv } from "./registerSW";

const baseEnv: PwaEnv = {
  isDesktop: false,
  hasWindow: true,
  hasServiceWorker: true,
  protocol: "https:",
  userAgent: "Mozilla/5.0",
};

describe("shouldRegisterPwa", () => {
  it("registers in normal browser", () => {
    expect(shouldRegisterPwa(baseEnv)).toBe(true);
  });

  it("bails when isDesktop", () => {
    expect(shouldRegisterPwa({ ...baseEnv, isDesktop: true })).toBe(false);
  });

  it("bails when window is missing (SSR)", () => {
    expect(shouldRegisterPwa({ ...baseEnv, hasWindow: false })).toBe(false);
  });

  it("bails when serviceWorker is unavailable", () => {
    expect(shouldRegisterPwa({ ...baseEnv, hasServiceWorker: false })).toBe(false);
  });

  it("bails on app:// protocol (Electron app://)", () => {
    expect(shouldRegisterPwa({ ...baseEnv, protocol: "app:" })).toBe(false);
  });

  it("bails on file:// protocol", () => {
    expect(shouldRegisterPwa({ ...baseEnv, protocol: "file:" })).toBe(false);
  });

  it("bails when userAgent contains Electron", () => {
    expect(shouldRegisterPwa({
      ...baseEnv,
      userAgent: "Mozilla/5.0 (Macintosh) Electron/40.0",
    })).toBe(false);
  });

  it("registers on http:// (local dev)", () => {
    expect(shouldRegisterPwa({ ...baseEnv, protocol: "http:" })).toBe(true);
  });
});
