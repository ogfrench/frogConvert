// Per-surface persistence machinery shared by PDF Workspace and Converter.
// Owns: sessionId lifecycle, dirty tracking, debounced flush, byte-diff writes,
// resume detection. Delegates: payload shape and apply step (per-surface).

import {
  getOrCreateSessionId,
  getCurrentSessionId,
  setStoredSessionId,
  clearStoredSessionId,
  saveSession,
  loadSession,
  loadMostRecentOrphan,
  clearSession,
  saveFileBytes,
  deleteFileBytes,
  loadAllFileBytes,
  debounce,
  type SessionKind,
  type SessionPayload,
  type StoredSession,
} from './sessionStore.ts';
import { showToast } from '../Toast/Toast.ts';

export interface PersistorSpec<P extends SessionPayload> {
  kind: SessionKind;
  /** Build the persistable manifest from current module state. */
  buildPayload: () => P;
  /** File ids currently in module state (mirrored to payload.files). */
  currentFileIds: () => number[];
  /** Resolve bytes for a given fileId - may be sync or async. */
  getBytesForId: (id: number) => Promise<Uint8Array> | Uint8Array;
  /** Restore module state from a payload + bytes. Returns true on success. */
  applyPayload: (payload: P, bytes: Map<number, Uint8Array>) => Promise<boolean> | boolean;
  /**
   * Test whether the surface is "fresh" (safe to silently overwrite). When the
   * user has already interacted (uploaded files, etc.) the cold-start restore
   * must NOT clobber their input. Defaults to currentFileIds().length === 0.
   */
  isPristine?: () => boolean;
}

export type RestoreOutcome<P extends SessionPayload> =
  | { status: 'silent' }
  | { status: 'orphan'; stored: StoredSession<P> }
  | { status: 'none' };

export interface Persistor<P extends SessionPayload> {
  /** Call from state-mutation sites (not renderers) when the file id set/order changes. */
  markFilesDirty: () => void;
  /** Call from state-mutation sites (not renderers) when other persistable state changes. */
  markManifestDirty: () => void;
  /**
   * Synchronously promote any pending debounced flush to immediate execution
   * and return a Promise that resolves when its async IDB writes complete.
   * Awaitable so callers (visibilitychange, pagehide) can hold the lifecycle
   * open as long as the platform allows.
   */
  flushOnHide: () => Promise<void>;
  clear: () => void;
  /** Same-tab self-restore is silent and applied here. Orphan returned to the caller for a popup. */
  tryRestore: () => Promise<RestoreOutcome<P>>;
  /** Apply a stored payload (called on user-confirmed Resume from orphan path). */
  resume: (stored: StoredSession<P>) => Promise<boolean>;
  /** Cancel pending flush + close BroadcastChannel. Tests use this between cases. */
  dispose: () => void;
}

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: number };
  // Browsers report quota exhaustion as DOMException QuotaExceededError (name)
  // or legacy code 22. Anything else - "no file with id N", network errors,
  // serialization failures - is NOT a quota issue and should not pause autosave.
  return e.name === 'QuotaExceededError' || e.code === 22;
}

export function createPersistor<P extends SessionPayload>(spec: PersistorSpec<P>): Persistor<P> {
  let sessionId: string | null = null;
  let lastWrittenIds = new Set<number>();
  let dirty: 'none' | 'manifest' | 'files' = 'none';
  let bytesQuotaPaused = false;
  let restoring = false;
  // In-flight flush promise, so flushOnHide can await whatever's already
  // running rather than racing alongside it.
  let inflightFlush: Promise<void> | null = null;

  // Per-instance random nonce so we can ignore our own broadcast messages
  // (BroadcastChannel does not echo to the source channel, but two channels
  // in the same window would still cross-talk if we ever opened a second).
  const nonce = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `n_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const channel: BroadcastChannel | null =
    typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`frogconvert:${spec.kind}`) : null;
  if (channel) {
    channel.onmessage = (ev) => {
      if (!ev.data || ev.data.from === nonce) return;
      if (ev.data.type === 'hello' && sessionId) {
        channel.postMessage({ type: 'claim', sessionId, from: nonce });
      }
    };
  }

  async function discoverLiveSessions(timeoutMs = 150): Promise<Set<string>> {
    const live = new Set<string>();
    if (!channel) return live;
    const onMsg = (ev: MessageEvent) => {
      if (!ev.data || ev.data.from === nonce) return;
      if (ev.data.type === 'claim' && typeof ev.data.sessionId === 'string') {
        live.add(ev.data.sessionId);
      }
    };
    channel.addEventListener('message', onMsg);
    try {
      channel.postMessage({ type: 'hello', from: nonce });
      await new Promise(r => setTimeout(r, timeoutMs));
    } finally {
      channel.removeEventListener('message', onMsg);
    }
    return live;
  }

  function ensureSessionId(): string {
    return sessionId ??= getOrCreateSessionId(spec.kind);
  }

  async function flushImpl(): Promise<void> {
    if (!sessionId || dirty === 'none') return;
    const sid = sessionId;
    const filesWereDirty = dirty === 'files';
    dirty = 'none';
    // Snapshot the manifest BEFORE writing bytes so we don't write a manifest
    // that references files whose bytes haven't landed yet. The flow:
    //   1. compute byte diff (adds/removes) against lastWrittenIds
    //   2. write byte adds (and only adds we successfully wrote)
    //   3. delete byte removes
    //   4. write manifest LAST, so the manifest is always consistent with
    //      what's actually in the byteStore. Tab kills between steps 2 and 4
    //      leave the manifest stale (pointing at the previous state) but
    //      every fileId it references still has bytes - no broken sessions.
    const manifest = spec.buildPayload();
    if (filesWereDirty && !bytesQuotaPaused) {
      const ids = new Set(spec.currentFileIds());
      const adds = [...ids].filter(id => !lastWrittenIds.has(id));
      const writtenAdds: number[] = [];
      for (const id of adds) {
        let bytes: Uint8Array;
        try {
          bytes = await spec.getBytesForId(id);
        } catch (err) {
          // File was removed mid-flush, or the spec couldn't resolve bytes.
          // NOT a quota issue - skip this id and keep going.
          console.warn(`[${spec.kind}] could not resolve bytes for id ${id}, skipping:`, err);
          continue;
        }
        try {
          await saveFileBytes(sid, id, bytes);
          writtenAdds.push(id);
        } catch (err) {
          if (isQuotaError(err)) {
            bytesQuotaPaused = true;
            console.warn(`[${spec.kind}] file-bytes save hit quota. Auto-save paused.`, err);
            showToast('Auto-save paused - storage full. Your current work is safe.', 'warn', 8000);
            // Stop trying further byte writes this flush. Manifest will still
            // be saved below, but it'll only reflect ids whose bytes we
            // successfully wrote (plus prior writes via lastWrittenIds).
            break;
          }
          console.warn(`[${spec.kind}] file-bytes save failed for id ${id}:`, err);
        }
      }
      const removes = [...lastWrittenIds].filter(id => !ids.has(id));
      await Promise.all(removes.map(id => deleteFileBytes(sid, id)));
      // lastWrittenIds = (previous - removes) + writtenAdds. If we hit quota
      // partway through `adds`, ids we couldn't write stay OUT of the set so
      // the next flush retries them.
      const next = new Set<number>();
      for (const id of lastWrittenIds) if (!removes.includes(id)) next.add(id);
      for (const id of writtenAdds) next.add(id);
      lastWrittenIds = next;
    }
    // Manifest write is last so it cannot reference unsaved bytes. We rebuild
    // the manifest here from current state (rather than reusing the snapshot)
    // because applyPayload-and-back-to-dirty cycles can have updated state.
    try {
      await saveSession(sid, spec.kind, spec.buildPayload());
    } catch (err) {
      console.warn(`[${spec.kind}] manifest save failed:`, err);
      // Best-effort: keep dirty flag as-is so next call retries the manifest.
      dirty = 'manifest';
      return;
    }
    // Suppress "unused" warning for the captured manifest (kept for clarity).
    void manifest;
  }

  async function flush(): Promise<void> {
    if (inflightFlush) return inflightFlush;
    inflightFlush = (async () => {
      try { await flushImpl(); }
      finally { inflightFlush = null; }
    })();
    return inflightFlush;
  }

  // Autosave is best-effort by design - every write inside `flushImpl` already
  // reports and carries on - but `buildPayload` is the caller's own code and
  // can still throw. Nothing is waiting on this promise, so an escape would
  // surface as an unhandled rejection and put the app-wide recovery popup on
  // screen over work that is perfectly fine.
  const flushQuietly = () => flush().catch((err) => {
    console.warn(`[${spec.kind}] auto-save flush failed:`, err);
  });

  const debouncedFlush = debounce(() => { void flushQuietly(); }, 1000);

  function mark(scope: 'manifest' | 'files'): void {
    if (restoring) return;
    if (typeof indexedDB === 'undefined') return;
    // Skip writes in automated browsers - pairs with the webdriver guard in
    // tryRestore so e2e flows can't hit IDB quota / NotFoundError edges and
    // surface a toast that obscures other UI under test.
    if (typeof navigator !== 'undefined' && navigator.webdriver) return;
    ensureSessionId();
    if (scope === 'files') dirty = 'files';
    else if (dirty !== 'files') dirty = 'manifest';
    debouncedFlush();
  }

  async function applyAndAdopt(stored: StoredSession<P>): Promise<boolean> {
    const bytes = await loadAllFileBytes(stored.sessionId);
    restoring = true;
    try {
      sessionId = stored.sessionId;
      setStoredSessionId(spec.kind, stored.sessionId);
      const ok = await spec.applyPayload(stored.payload, bytes);
      if (ok) lastWrittenIds = new Set(spec.currentFileIds());
      return ok;
    } finally {
      restoring = false;
    }
  }

  return {
    markFilesDirty: () => mark('files'),
    markManifestDirty: () => mark('manifest'),
    flushOnHide: async () => {
      // Promote any queued debounced invocation, then await any in-flight
      // flush (including the one we just kicked off). Callers can `await
      // persistor.flushOnHide()` from a visibilitychange / pagehide handler;
      // browsers honour outstanding work for as long as the page lives.
      debouncedFlush.flush();
      if (inflightFlush) {
        await inflightFlush.catch((err) => {
          console.warn(`[${spec.kind}] auto-save flush failed:`, err);
        });
      }
    },
    clear: () => {
      if (!sessionId) return;
      debouncedFlush.cancel();
      void clearSession(sessionId);
      clearStoredSessionId(spec.kind);
      sessionId = null;
      lastWrittenIds = new Set();
      dirty = 'none';
      bytesQuotaPaused = false;
    },
    tryRestore: async () => {
      if (typeof indexedDB === 'undefined') return { status: 'none' };
      // Skip restore in automated browsers (Puppeteer/Playwright/Selenium) so the
      // resume popup never blocks e2e flows. navigator.webdriver is the
      // standardised automation flag (W3C WebDriver §8.6).
      if (typeof navigator !== 'undefined' && navigator.webdriver) return { status: 'none' };
      let existing = getCurrentSessionId(spec.kind);
      // Probe live siblings before deciding. If another tab claims our
      // sessionStorage id, this is a tab clone (Chrome "Duplicate tab"
      // copies sessionStorage verbatim) - mint a fresh id and fall through
      // to the orphan path so we don't last-write-win against the original.
      const live = await discoverLiveSessions();
      if (existing && live.has(existing)) {
        clearStoredSessionId(spec.kind);
        existing = null;
      }
      const self = existing ? await loadSession<P>(existing) : null;
      if (self) {
        // Cold-start race guard: the user may have dropped a file in the
        // ~150ms window between page load and the BroadcastChannel handshake.
        // Silently overwriting their input would re-introduce the data-loss
        // class commit ca208cd was meant to fix. Treat a non-pristine surface
        // as an orphan instead - keeps the user's drop, offers them a Resume
        // popup if they want the persisted session back.
        const pristine = spec.isPristine
          ? spec.isPristine()
          : spec.currentFileIds().length === 0;
        if (!pristine) return { status: 'orphan', stored: self };
        await applyAndAdopt(self);
        return { status: 'silent' };
      }
      const id = ensureSessionId();
      const orphan = await loadMostRecentOrphan<P>(spec.kind, id, live);
      return orphan ? { status: 'orphan', stored: orphan } : { status: 'none' };
    },
    resume: applyAndAdopt,
    dispose: () => {
      debouncedFlush.cancel();
      if (channel) channel.close();
    },
  };
}
