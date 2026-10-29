// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { showToast, dismissToast } from "./Toast.ts";

describe("toast notifications", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    dismissToast();
  });

  afterEach(() => {
    document.querySelector(".toast")?.dispatchEvent(new Event("mouseleave"));
    (document.activeElement as HTMLElement)?.blur?.();
    dismissToast();
    vi.useRealTimers();
  });

  it("uses polite announcements and a semantic icon for warnings", () => {
    showToast("Storage almost full", "warn", 5000);
    const toast = document.querySelector<HTMLElement>(".toast")!;
    expect(toast.getAttribute("role")).toBe("status");
    expect(toast.getAttribute("aria-live")).toBe("polite");
    expect(toast.classList.contains("variant-warn")).toBe(true);
    expect(toast.querySelector(".toast-icon svg")).not.toBeNull();
    expect(toast.querySelector(".toast-text")?.textContent).toBe("Storage almost full");
    vi.advanceTimersByTime(5000);
    expect(toast.classList.contains("open")).toBe(false);
  });

  it("keeps an error visible and prevents informational messages from replacing it", () => {
    showToast("Conversion failed", "error");
    const toast = document.querySelector<HTMLElement>(".toast")!;
    expect(toast.getAttribute("role")).toBe("alert");
    expect(toast.getAttribute("aria-live")).toBe("assertive");
    showToast("Background task done", "info");
    expect(toast.querySelector(".toast-text")?.textContent).toBe("Conversion failed");
    vi.advanceTimersByTime(9999);
    expect(toast.classList.contains("open")).toBe(true);
    toast.querySelector<HTMLButtonElement>(".toast-dismiss")!.click();
    expect(toast.classList.contains("open")).toBe(false);
    showToast("Background task done", "info", 100);
    expect(toast.querySelector(".toast-text")?.textContent).toBe("Background task done");
  });

  it("pauses the dismissal timer while hovered and resumes when the pointer leaves", () => {
    showToast("Saved", "info", 4000);
    const toast = document.querySelector<HTMLElement>(".toast")!;
    vi.advanceTimersByTime(1000);
    toast.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(10000);
    expect(toast.classList.contains("open")).toBe(true);
    toast.dispatchEvent(new Event("mouseleave"));
    vi.advanceTimersByTime(2999);
    expect(toast.classList.contains("open")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(toast.classList.contains("open")).toBe(false);
  });

  it("auto-dismisses stale errors after ten seconds", () => {
    showToast("Conversion failed", "error");
    const toast = document.querySelector<HTMLElement>(".toast")!;
    vi.advanceTimersByTime(10000);
    expect(toast.classList.contains("open")).toBe(false);
    showToast("Retry started", "info");
    expect(toast.querySelector(".toast-text")?.textContent).toBe("Retry started");
  });

  it("lets keyboard users dismiss the message", () => {
    showToast("Queued", "info");
    const toast = document.querySelector<HTMLElement>(".toast")!;
    const button = toast.querySelector<HTMLButtonElement>(".toast-dismiss")!;
    expect(button.getAttribute("aria-label")).toBe("Dismiss");
    button.focus();
    button.click();
    expect(toast.classList.contains("open")).toBe(false);
  });

  it("stays paused until both pointer and keyboard focus have left", () => {
    showToast("Saved", "info", 4000);
    const toast = document.querySelector<HTMLElement>(".toast")!;
    const button = toast.querySelector<HTMLButtonElement>(".toast-dismiss")!;
    vi.advanceTimersByTime(1000);
    toast.dispatchEvent(new Event("mouseenter"));
    button.focus();
    toast.dispatchEvent(new Event("mouseleave"));
    vi.advanceTimersByTime(10000);
    expect(toast.classList.contains("open")).toBe(true);
    toast.dispatchEvent(new Event("mouseenter"));
    button.blur();
    vi.advanceTimersByTime(10000);
    expect(toast.classList.contains("open")).toBe(true);
    toast.dispatchEvent(new Event("mouseleave"));
    vi.advanceTimersByTime(3000);
    expect(toast.classList.contains("open")).toBe(false);
  });

  it("does not restart dismissal when a hovered message is replaced", () => {
    showToast("Preparing", "info", 4000);
    const toast = document.querySelector<HTMLElement>(".toast")!;
    toast.dispatchEvent(new Event("mouseenter"));
    showToast("Ready", "info", 4000);
    vi.advanceTimersByTime(10000);
    expect(toast.classList.contains("open")).toBe(true);
    toast.dispatchEvent(new Event("mouseleave"));
    vi.advanceTimersByTime(4000);
    expect(toast.classList.contains("open")).toBe(false);
  });
});
