// Session persistence shared by Converter and PDF Workspace.
// Native IndexedDB. Two stores:
//   `sessions`   keyPath sessionId, index on `kind`
//   `fileBytes`  keyPath key ("<sessionId>:<fileId>"), index on `sessionId`
//
// Resume rules: same-tab reload (sessionStorage carries sessionId) silently
// auto-restores. Otherwise the most-recent orphan of the same `kind` is offered
// as a "Resume?" prompt. Bytes round-trip as Uint8Array - no Blob conversion.
//
// Implementation note: IndexedDB transactions auto-commit when control returns
// to the event loop with no pending requests. Mixing `await` with subsequent
// IDB ops inside one tx silently breaks. So all multi-step transactions below
// chain requests via onsuccess instead of awaiting between them.

import {
  safeSessionStorageGet,
  safeSessionStorageSet,
  safeSessionStorageRemove,
} from '../utils/index.ts';

const DB_NAME = 'frogconvert';
const DB_VERSION = 1;
const STORE_SESSIONS = 'sessions';
const STORE_FILE_BYTES = 'fileBytes';
const SCHEMA_VERSION = 1;
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export type SessionKind = 'pdfWorkspace' | 'convertPage' | 'compressPage';

export interface PersistedFileMeta {
  id: number;
  name: string;
  size: number;
  // PDF Workspace only
  pageCount?: number;
  // Converter only
  type?: string;
  lastModified?: number;
}

export interface PdfWorkspacePayload {
  activeTool: 'merge' | 'organize' | 'watermark';
  files: PersistedFileMeta[];
  pages: unknown[];
  selected: number[];
  /** Merge-tab file selection (file ids). */
  selectedFiles?: number[];
  /** Watermark-tab page selection. New form: `${fileId}:${pageNum}` keys
   *  (semantic, survives reorder). Legacy form: flat indices into the old
   *  wmFlatPages array. Restore accepts either. */
  wmSelected?: (string | number)[];
  wmSettings: Record<string, unknown>;
}

export interface ConvertPagePayload {
  files: PersistedFileMeta[];
  targetFormat: string | null;
}

export interface CompressPagePayload {
  files: PersistedFileMeta[];
  /**
   * The Compress level the user picked: auto | high | medium | low. Note this
   * is *not* the full QualityPreset set — Compress deliberately offers no
   * lossless level, because as a compression level it could only ever do
   * nothing (see docs/COMPRESS.md).
   */
  level: string;
}

export type SessionPayload = PdfWorkspacePayload | ConvertPagePayload | CompressPagePayload;

export interface StoredSession<P extends SessionPayload = SessionPayload> {
  sessionId: string;
  kind: SessionKind;
  version: number;
  savedAt: number;
  payload: P;
}

interface StoredFileBytes {
  key: string;
  sessionId: string;
  fileId: number;
  bytes: Uint8Array;
}

let cachedDb: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

function isAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  if (!isAvailable()) return Promise.reject(new Error('IndexedDB unavailable'));
  if (cachedDb) return Promise.resolve(cachedDb);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        const sessions = db.createObjectStore(STORE_SESSIONS, { keyPath: 'sessionId' });
        sessions.createIndex('kind', 'kind', { unique: false });
        sessions.createIndex('savedAt', 'savedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_FILE_BYTES)) {
        const bytes = db.createObjectStore(STORE_FILE_BYTES, { keyPath: 'key' });
        bytes.createIndex('sessionId', 'sessionId', { unique: false });
      }
    };
    req.onsuccess = () => { cachedDb = req.result; resolve(req.result); };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
  return dbPromise;
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txComplete(t: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Transaction aborted'));
  });
}

const SESSION_STORAGE_KEY = (kind: SessionKind) => `frogconvert:${kind}:sessionId`;

function freshId(): string {
  return (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function isExpired(row: { version: number; savedAt: number }, now: number): boolean {
  return row.version !== SCHEMA_VERSION || now - row.savedAt > STALE_AFTER_MS;
}

export function getOrCreateSessionId(kind: SessionKind): string {
  const key = SESSION_STORAGE_KEY(kind);
  const existing = safeSessionStorageGet(key);
  if (existing) return existing;
  const fresh = freshId();
  safeSessionStorageSet(key, fresh);
  return fresh;
}

export function getCurrentSessionId(kind: SessionKind): string | null {
  return safeSessionStorageGet(SESSION_STORAGE_KEY(kind));
}

export function clearStoredSessionId(kind: SessionKind): void {
  safeSessionStorageRemove(SESSION_STORAGE_KEY(kind));
}

export function setStoredSessionId(kind: SessionKind, sessionId: string): void {
  safeSessionStorageSet(SESSION_STORAGE_KEY(kind), sessionId);
}

export async function saveSession<P extends SessionPayload>(
  sessionId: string,
  kind: SessionKind,
  payload: P,
): Promise<void> {
  if (!isAvailable()) return;
  const row: StoredSession<P> = {
    sessionId,
    kind,
    version: SCHEMA_VERSION,
    savedAt: Date.now(),
    payload,
  };
  try {
    const db = await openDb();
    const t = db.transaction(STORE_SESSIONS, 'readwrite');
    t.objectStore(STORE_SESSIONS).put(row);
    await txComplete(t);
  } catch (err) {
    console.warn('[sessionStore] saveSession failed:', err);
  }
}

export async function loadSession<P extends SessionPayload>(
  sessionId: string,
): Promise<StoredSession<P> | null> {
  if (!isAvailable()) return null;
  try {
    const db = await openDb();
    const t = db.transaction(STORE_SESSIONS, 'readonly');
    const row = (await reqAsPromise(t.objectStore(STORE_SESSIONS).get(sessionId))) as StoredSession<P> | undefined;
    await txComplete(t);
    if (!row) return null;
    if (isExpired(row, Date.now())) {
      // Stale or wrong version - wipe (separate tx; safe and simple).
      await clearSession(sessionId);
      return null;
    }
    return row;
  } catch (err) {
    console.warn('[sessionStore] loadSession failed:', err);
    return null;
  }
}

export async function loadMostRecentOrphan<P extends SessionPayload>(
  kind: SessionKind,
  currentSessionId: string,
  liveSessionIds: ReadonlySet<string> = new Set(),
): Promise<StoredSession<P> | null> {
  if (!isAvailable()) return null;
  try {
    const db = await openDb();
    const t = db.transaction(STORE_SESSIONS, 'readonly');
    const rows = (await reqAsPromise(
      t.objectStore(STORE_SESSIONS).index('kind').getAll(kind),
    )) as StoredSession<P>[];
    await txComplete(t);
    const now = Date.now();
    const stale: string[] = [];
    let best: StoredSession<P> | null = null;
    for (const row of rows) {
      if (isExpired(row, now)) {
        stale.push(row.sessionId);
        continue;
      }
      if (row.sessionId === currentSessionId) continue;
      if (liveSessionIds.has(row.sessionId)) continue;
      if (!best || row.savedAt > best.savedAt) best = row;
    }
    await Promise.all(stale.map(id => clearSession(id)));
    return best;
  } catch (err) {
    console.warn('[sessionStore] loadMostRecentOrphan failed:', err);
    return null;
  }
}

export async function clearSession(sessionId: string): Promise<void> {
  if (!isAvailable()) return;
  try {
    const db = await openDb();
    const t = db.transaction([STORE_SESSIONS, STORE_FILE_BYTES], 'readwrite');
    const sessionsStore = t.objectStore(STORE_SESSIONS);
    const fileBytesStore = t.objectStore(STORE_FILE_BYTES);
    sessionsStore.delete(sessionId);
    // Cascade: collect keys via index, queue deletes synchronously inside the
    // same getAllKeys onsuccess so the tx stays alive.
    const idx = fileBytesStore.index('sessionId');
    const keysReq = idx.getAllKeys(sessionId);
    keysReq.onsuccess = () => {
      const keys = keysReq.result as IDBValidKey[];
      for (const k of keys) fileBytesStore.delete(k);
    };
    await txComplete(t);
  } catch (err) {
    console.warn('[sessionStore] clearSession failed:', err);
  }
}

export async function saveFileBytes(
  sessionId: string,
  fileId: number,
  bytes: Uint8Array,
): Promise<void> {
  if (!isAvailable()) return;
  const row: StoredFileBytes = {
    key: `${sessionId}:${fileId}`,
    sessionId,
    fileId,
    bytes,
  };
  // Surface quota errors to the caller; they decide whether to pause autosave.
  const db = await openDb();
  const t = db.transaction(STORE_FILE_BYTES, 'readwrite');
  t.objectStore(STORE_FILE_BYTES).put(row);
  await txComplete(t);
}

export async function deleteFileBytes(sessionId: string, fileId: number): Promise<void> {
  if (!isAvailable()) return;
  try {
    const db = await openDb();
    const t = db.transaction(STORE_FILE_BYTES, 'readwrite');
    t.objectStore(STORE_FILE_BYTES).delete(`${sessionId}:${fileId}`);
    await txComplete(t);
  } catch (err) {
    console.warn('[sessionStore] deleteFileBytes failed:', err);
  }
}

export async function loadAllFileBytes(sessionId: string): Promise<Map<number, Uint8Array>> {
  const out = new Map<number, Uint8Array>();
  if (!isAvailable()) return out;
  try {
    const db = await openDb();
    const t = db.transaction(STORE_FILE_BYTES, 'readonly');
    const rows = (await reqAsPromise(
      t.objectStore(STORE_FILE_BYTES).index('sessionId').getAll(sessionId),
    )) as StoredFileBytes[];
    await txComplete(t);
    for (const row of rows) out.set(row.fileId, row.bytes);
  } catch (err) {
    console.warn('[sessionStore] loadAllFileBytes failed:', err);
  }
  return out;
}

// Tail-only debounce. flush() runs the pending invocation immediately.
export interface Debounced<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): void;
  flush: () => void;
  cancel: () => void;
}

export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  ms: number,
): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;
  const wrapper = ((...args: Parameters<T>) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const a = lastArgs!;
      lastArgs = null;
      fn(...a);
    }, ms);
  }) as Debounced<T>;
  wrapper.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      const a = lastArgs!;
      lastArgs = null;
      if (a) fn(...a);
    }
  };
  wrapper.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };
  return wrapper;
}

// Test-only - close the cached connection so deleteDatabase can run unblocked
// in test setup.
export function __resetForTest(): void {
  if (cachedDb) { try { cachedDb.close(); } catch {} cachedDb = null; }
  dbPromise = null;
}
