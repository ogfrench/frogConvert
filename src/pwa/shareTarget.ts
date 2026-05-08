import { SHARE_TARGET_CACHE, EXTERNAL_FILES_EVENT } from "./shareTargetConstants.ts";

export function initShareTargetAndLaunchQueue(): void {
  if (typeof window === "undefined") return;

  void readShareTargetPayload();

  if ("launchQueue" in window && window.launchQueue) {
    window.launchQueue.setConsumer(async (params) => {
      if (!params.files || params.files.length === 0) return;
      try {
        const files: File[] = [];
        for (const handle of params.files) {
          const file = await handle.getFile();
          files.push(file);
        }
        if (files.length > 0) deliverExternalFiles(files);
      } catch (err) {
        console.warn("[pwa] launchQueue read failed:", err);
      }
    });
  }
}

async function readShareTargetPayload(): Promise<void> {
  if (!isShareTargetReady(location.search)) return;

  history.replaceState(null, "", location.pathname + location.hash);

  if (!("caches" in self)) return;

  try {
    const cache = await caches.open(SHARE_TARGET_CACHE);
    const files = await extractSharedFilesFromCache(cache);
    if (files.length > 0) deliverExternalFiles(files);
  } catch (err) {
    console.warn("[pwa] share-target replay failed:", err);
  }
}

export function isShareTargetReady(search: string): boolean {
  return new URLSearchParams(search).get("share-target") === "ready";
}

export async function extractSharedFilesFromCache(cache: Pick<Cache, "match" | "delete">): Promise<File[]> {
  const meta = await cache.match("__share-payload");
  if (!meta) return [];
  const { count } = await meta.json() as { count: number };

  const indices = Array.from({ length: count }, (_, i) => i);
  const slots = await Promise.all(indices.map(async (i) => {
    const resp = await cache.match(`__share-file-${i}`);
    if (!resp) return null;
    const filename = decodeURIComponent(resp.headers.get("X-Filename") ?? `shared-${i}`);
    const blob = await resp.blob();
    return new File([blob], filename, { type: blob.type });
  }));
  const files = slots.filter((f): f is File => f !== null);

  await Promise.all([
    cache.delete("__share-payload"),
    ...indices.map(i => cache.delete(`__share-file-${i}`)),
  ]);

  return files;
}

function deliverExternalFiles(files: File[]): void {
  // CustomEvent (not a synthesised DragEvent) avoids Firefox <100 / Safari
  // fragility around synthetic DataTransfer entries. main.ts owns the
  // routing decision (Converter vs PDF Editor vs ask).
  const dispatch = () => {
    try {
      window.dispatchEvent(new CustomEvent(EXTERNAL_FILES_EVENT, { detail: { files } }));
    } catch (err) {
      console.warn("[pwa] could not dispatch external-files event:", err);
    }
  };

  // Wait for `load` (not DOMContentLoaded) because main.ts registers its
  // listener during top-level execution, which on cold-start can finish after
  // `interactive` but before `complete`.
  if (document.readyState === "complete") {
    dispatch();
  } else {
    window.addEventListener("load", dispatch, { once: true });
  }
}
