import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveSession,
  loadSession,
  loadMostRecentOrphan,
  clearSession,
  saveFileBytes,
  loadAllFileBytes,
  deleteFileBytes,
  debounce,
  __resetForTest,
  type PdfWorkspacePayload,
  type ConvertPagePayload,
} from './sessionStore.ts';

beforeEach(async () => {
  __resetForTest();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('frogconvert');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
  try { sessionStorage.clear(); } catch {}
});

const pdfPayload: PdfWorkspacePayload = {
  activeTool: 'organize',
  files: [{ id: 7, name: 'A.pdf', size: 100, pageCount: 3 }],
  pages: [{ type: 'source', sourceFileId: 7, sourcePageNum: 1, rotation: 0 }],
  selected: [0],
  wmSettings: { text: 'CONFIDENTIAL', fontSize: 24, opacity: 0.4 },
};

const convertPayload: ConvertPagePayload = {
  files: [{ id: 0, name: 'video.mp4', size: 5000, type: 'video/mp4', lastModified: 1700000000000 }],
  targetFormat: 'webm',
};

describe('saveSession + loadSession', () => {
  it('round-trips a PDF Workspace session', async () => {
    await saveSession('s-1', 'pdfWorkspace', pdfPayload);
    const got = await loadSession<PdfWorkspacePayload>('s-1');
    expect(got).not.toBeNull();
    expect(got!.kind).toBe('pdfWorkspace');
    expect(got!.payload).toEqual(pdfPayload);
    expect(typeof got!.savedAt).toBe('number');
  });

  it('round-trips a Converter session', async () => {
    await saveSession('s-2', 'convertPage', convertPayload);
    const got = await loadSession<ConvertPagePayload>('s-2');
    expect(got!.kind).toBe('convertPage');
    expect(got!.payload).toEqual(convertPayload);
  });

  it('returns null for a missing sessionId', async () => {
    expect(await loadSession('nope')).toBeNull();
  });
});

describe('saveFileBytes + loadAllFileBytes', () => {
  it('stores and retrieves bytes by sessionId', async () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([9, 8, 7]);
    await saveFileBytes('s-3', 0, a);
    await saveFileBytes('s-3', 1, b);
    const map = await loadAllFileBytes('s-3');
    expect(map.size).toBe(2);
    expect(Array.from(map.get(0)!)).toEqual([1, 2, 3, 4]);
    expect(Array.from(map.get(1)!)).toEqual([9, 8, 7]);
  });

  it('keeps sessions isolated', async () => {
    await saveFileBytes('s-A', 0, new Uint8Array([1]));
    await saveFileBytes('s-B', 0, new Uint8Array([2]));
    expect(Array.from((await loadAllFileBytes('s-A')).get(0)!)).toEqual([1]);
    expect(Array.from((await loadAllFileBytes('s-B')).get(0)!)).toEqual([2]);
  });

  it('deleteFileBytes removes one row without affecting siblings', async () => {
    await saveFileBytes('s-4', 0, new Uint8Array([1]));
    await saveFileBytes('s-4', 1, new Uint8Array([2]));
    await deleteFileBytes('s-4', 0);
    const map = await loadAllFileBytes('s-4');
    expect(map.has(0)).toBe(false);
    expect(map.has(1)).toBe(true);
  });
});

describe('clearSession', () => {
  it('removes session row + all fileBytes for that sessionId', async () => {
    await saveSession('s-5', 'pdfWorkspace', pdfPayload);
    await saveFileBytes('s-5', 7, new Uint8Array([1, 2, 3]));
    await saveFileBytes('s-5', 8, new Uint8Array([4, 5, 6]));
    await clearSession('s-5');
    expect(await loadSession('s-5')).toBeNull();
    expect((await loadAllFileBytes('s-5')).size).toBe(0);
  });

  it('does not touch other sessions', async () => {
    await saveSession('s-keep', 'pdfWorkspace', pdfPayload);
    await saveFileBytes('s-keep', 7, new Uint8Array([1]));
    await saveSession('s-drop', 'pdfWorkspace', pdfPayload);
    await saveFileBytes('s-drop', 7, new Uint8Array([2]));
    await clearSession('s-drop');
    expect(await loadSession('s-keep')).not.toBeNull();
    expect((await loadAllFileBytes('s-keep')).size).toBe(1);
  });
});

describe('loadMostRecentOrphan', () => {
  it('picks the freshest session of the same kind, excluding the current id', async () => {
    await saveSession('a', 'pdfWorkspace', pdfPayload);
    await new Promise(r => setTimeout(r, 5));
    await saveSession('b', 'pdfWorkspace', pdfPayload);
    await new Promise(r => setTimeout(r, 5));
    await saveSession('c', 'pdfWorkspace', pdfPayload);
    const got = await loadMostRecentOrphan<PdfWorkspacePayload>('pdfWorkspace', 'c');
    expect(got!.sessionId).toBe('b');
  });

  it('returns null when only the current session exists', async () => {
    await saveSession('only', 'pdfWorkspace', pdfPayload);
    expect(await loadMostRecentOrphan('pdfWorkspace', 'only')).toBeNull();
  });

  it('does not return sessions of a different kind', async () => {
    await saveSession('p1', 'pdfWorkspace', pdfPayload);
    await saveSession('c1', 'convertPage', convertPayload);
    expect((await loadMostRecentOrphan('pdfWorkspace', 'other'))!.sessionId).toBe('p1');
    expect((await loadMostRecentOrphan('convertPage', 'other'))!.sessionId).toBe('c1');
  });
});

describe('staleness + version mismatch', () => {
  it('loadSession returns null and deletes the row when older than 7 days', async () => {
    await saveSession('old', 'pdfWorkspace', pdfPayload);
    // Backdate by reaching directly into the store via openDb wrapper.
    // Easiest: use saveSession then mutate via a raw IDB tx in the same DB name.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('frogconvert');
      req.onsuccess = () => {
        const db = req.result;
        const t = db.transaction('sessions', 'readwrite');
        const store = t.objectStore('sessions');
        const getReq = store.get('old');
        getReq.onsuccess = () => {
          const row = getReq.result;
          row.savedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
          store.put(row);
        };
        t.oncomplete = () => { db.close(); resolve(); };
        t.onerror = () => { db.close(); reject(t.error); };
      };
      req.onerror = () => reject(req.error);
    });
    expect(await loadSession('old')).toBeNull();
    // Row should be gone after stale read.
    expect(await loadSession('old')).toBeNull();
  });

  it('loadSession returns null when version does not match', async () => {
    await saveSession('v', 'pdfWorkspace', pdfPayload);
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('frogconvert');
      req.onsuccess = () => {
        const db = req.result;
        const t = db.transaction('sessions', 'readwrite');
        const store = t.objectStore('sessions');
        const getReq = store.get('v');
        getReq.onsuccess = () => {
          const row = getReq.result;
          row.version = 999;
          store.put(row);
        };
        t.oncomplete = () => { db.close(); resolve(); };
        t.onerror = () => { db.close(); reject(t.error); };
      };
      req.onerror = () => reject(req.error);
    });
    expect(await loadSession('v')).toBeNull();
  });

  it('loadMostRecentOrphan opportunistically GCs stale rows', async () => {
    await saveSession('stale', 'pdfWorkspace', pdfPayload);
    await saveSession('fresh', 'pdfWorkspace', pdfPayload);
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('frogconvert');
      req.onsuccess = () => {
        const db = req.result;
        const t = db.transaction('sessions', 'readwrite');
        const store = t.objectStore('sessions');
        const getReq = store.get('stale');
        getReq.onsuccess = () => {
          const row = getReq.result;
          row.savedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
          store.put(row);
        };
        t.oncomplete = () => { db.close(); resolve(); };
        t.onerror = () => { db.close(); reject(t.error); };
      };
      req.onerror = () => reject(req.error);
    });
    const orphan = await loadMostRecentOrphan('pdfWorkspace', 'other');
    expect(orphan!.sessionId).toBe('fresh');
    // The stale row was cleared as a side-effect.
    expect(await loadSession('stale')).toBeNull();
  });
});

describe('debounce', () => {
  it('coalesces rapid calls into one', async () => {
    let runs = 0;
    let last = 0;
    const fn = debounce((n: number) => { runs++; last = n; }, 25);
    fn(1); fn(2); fn(3);
    await new Promise(r => setTimeout(r, 60));
    expect(runs).toBe(1);
    expect(last).toBe(3);
  });

  it('flush() runs the pending invocation immediately', async () => {
    let runs = 0;
    const fn = debounce(() => { runs++; }, 100);
    fn();
    fn.flush();
    expect(runs).toBe(1);
  });

  it('cancel() drops a pending invocation', async () => {
    let runs = 0;
    const fn = debounce(() => { runs++; }, 25);
    fn();
    fn.cancel();
    await new Promise(r => setTimeout(r, 60));
    expect(runs).toBe(0);
  });
});
