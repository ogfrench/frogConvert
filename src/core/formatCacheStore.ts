// ---------------------------------------------------------------------------
// Persistence for the supported-format cache
// ---------------------------------------------------------------------------
// The format list is expensive to rebuild (Phase 1 + Phase 2 handler init), so
// it is persisted to localStorage and read back on the next load. That read
// used to be unconditional, which pinned every returning user to whatever
// format list their *first* visit produced: the cache.json fetch sat in an
// `else` branch that only ran when the key was absent, so a user who had
// loaded the app even once never saw a new format again.
//
// The stored blob is therefore stamped with the build that produced it, and
// rejected when the running build differs. A rejected entry falls through to
// the cache.json fetch, which is the behaviour we wanted all along.
//
// Why the build SHA and not a hash of cache.json: what gets persisted is
// `window.supportedFormatCache` *after* handler init, which is not the same
// thing as cache.json. Handlers add and remove entries at runtime (see the
// libreoffice handler, which deletes its own stale entry). Tying the blob to
// the code that produced it is the honest key. It costs one cache.json refetch
// per deploy per user, which is a 153 KB request we make once.

import type { FileFormat } from "./FormatHandler/FormatHandler.ts";

export const FORMAT_CACHE_KEY = "supportedFormatCache";

export type FormatCacheEntries = Array<[string, FileFormat[]]>;

interface StoredFormatCache {
  version: string;
  entries: FormatCacheEntries;
}

function isStored(value: unknown): value is StoredFormatCache {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as StoredFormatCache).version === "string" &&
    Array.isArray((value as StoredFormatCache).entries)
  );
}

/**
 * Read the persisted format cache, but only if it was written by this build.
 *
 * Returns `null`, and clears the key, for anything unusable: absent,
 * unparseable, written by a different build, or in the legacy unversioned
 * shape (a bare array, which is what shipped before this module existed).
 * Clearing on mismatch means the self-heal happens once rather than on every
 * load.
 */
export function readFormatCache(storage: Storage, version: string): FormatCacheEntries | null {
  let raw: string | null;
  try {
    raw = storage.getItem(FORMAT_CACHE_KEY);
  } catch {
    // Storage disabled entirely (Safari private mode, blocked cookies).
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    discard(storage);
    return null;
  }

  if (!isStored(parsed) || parsed.version !== version) {
    discard(storage);
    return null;
  }

  return parsed.entries;
}

/**
 * Persist the format cache against the current build.
 *
 * Never throws. `setItem` raises QuotaExceededError synchronously when origin
 * storage is full, and this runs on the Phase-2 path where an uncaught throw
 * would take the rest of the load down with it. Returns whether the write
 * landed, for callers that want to log.
 */
export function writeFormatCache(
  storage: Storage,
  version: string,
  entries: FormatCacheEntries,
): boolean {
  try {
    const payload: StoredFormatCache = { version, entries };
    storage.setItem(FORMAT_CACHE_KEY, JSON.stringify(payload));
    return true;
  } catch (e) {
    console.warn("[formatCache] persist failed (quota or disabled):", e);
    return false;
  }
}

function discard(storage: Storage): void {
  try {
    storage.removeItem(FORMAT_CACHE_KEY);
  } catch {
    // Nothing to do: if we cannot clear it we simply re-reject it next load.
  }
}
