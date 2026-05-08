// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPersistor, type Persistor } from './createPersistor.ts';
import {
  setStoredSessionId,
  getCurrentSessionId,
  saveSession,
  saveFileBytes,
  loadSession,
  loadAllFileBytes,
  __resetForTest,
  type ConvertPagePayload,
  type SessionPayload,
} from './sessionStore.ts';

const created: Array<Persistor<any>> = [];
function track<P extends SessionPayload>(p: Persistor<P>): Persistor<P> {
  created.push(p);
  return p;
}

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

afterEach(() => {
  for (const p of created) p.dispose();
  created.length = 0;
});

function makeSpec(state: {
  files: Array<{ id: number; name: string; size: number; type?: string; lastModified?: number; bytes: Uint8Array }>;
  targetFormat: string | null;
}): Parameters<typeof createPersistor<ConvertPagePayload>>[0] {
  return {
    kind: 'convertPage',
    buildPayload: () => ({
      files: state.files.map(f => ({
        id: f.id, name: f.name, size: f.size, type: f.type, lastModified: f.lastModified,
      })),
      targetFormat: state.targetFormat,
    }),
    currentFileIds: () => state.files.map(f => f.id),
    getBytesForId: (id) => state.files.find(f => f.id === id)!.bytes,
    applyPayload: (payload, bytes) => {
      state.files = payload.files.map(meta => ({
        id: meta.id, name: meta.name, size: meta.size,
        type: meta.type, lastModified: meta.lastModified,
        bytes: bytes.get(meta.id)!,
      }));
      state.targetFormat = payload.targetFormat;
      return true;
    },
  };
}

describe('createPersistor', () => {
  it('tryRestore returns "none" with empty IDB and no sessionStorage', async () => {
    const p = track(createPersistor(makeSpec({ files: [], targetFormat: null })));
    const result = await p.tryRestore();
    expect(result.status).toBe('none');
  });

  it('mark + debounced flush persists manifest + bytes', async () => {
    vi.useFakeTimers();
    try {
      const state = {
        files: [{ id: 0, name: 'a.txt', size: 3, type: 'text/plain', bytes: new Uint8Array([1, 2, 3]) }],
        targetFormat: 'pdf',
      };
      const p = track(createPersistor(makeSpec(state)));
      p.markFilesDirty();
      await vi.advanceTimersByTimeAsync(1500);
      vi.useRealTimers();
      const sid = getCurrentSessionId('convertPage')!;
      expect(sid).toBeTruthy();
      const stored = await loadSession<ConvertPagePayload>(sid);
      expect(stored!.payload.targetFormat).toBe('pdf');
      expect(stored!.payload.files[0].name).toBe('a.txt');
      const bytes = await loadAllFileBytes(sid);
      expect(Array.from(bytes.get(0)!)).toEqual([1, 2, 3]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tryRestore performs silent self-restore when sessionStorage carries a matching id', async () => {
    const sid = 'self-1';
    setStoredSessionId('convertPage', sid);
    await saveSession(sid, 'convertPage', {
      files: [{ id: 5, name: 'x.png', size: 4, type: 'image/png', lastModified: 0 }],
      targetFormat: 'webp',
    });
    await saveFileBytes(sid, 5, new Uint8Array([9, 9, 9, 9]));

    const state = { files: [] as any[], targetFormat: null as string | null };
    const p = track(createPersistor(makeSpec(state)));
    const result = await p.tryRestore();
    expect(result.status).toBe('silent');
    expect(state.files).toHaveLength(1);
    expect(state.files[0].name).toBe('x.png');
    expect(Array.from(state.files[0].bytes)).toEqual([9, 9, 9, 9]);
    expect(state.targetFormat).toBe('webp');
  });

  it('tryRestore returns orphan when a different sessionId exists in IDB', async () => {
    const orphanSid = 'orphan-1';
    await saveSession(orphanSid, 'convertPage', {
      files: [{ id: 0, name: 'orphan.bin', size: 2 }],
      targetFormat: 'pdf',
    });
    await saveFileBytes(orphanSid, 0, new Uint8Array([4, 2]));

    setStoredSessionId('convertPage', 'new-tab-sid');

    const p = track(createPersistor(makeSpec({ files: [], targetFormat: null })));
    const result = await p.tryRestore();
    expect(result.status).toBe('orphan');
    if (result.status === 'orphan') {
      expect(result.stored.sessionId).toBe(orphanSid);
    }
  });

  it('resume(stored) applies the payload and adopts its sessionId', async () => {
    const sid = 'resume-1';
    await saveSession(sid, 'convertPage', {
      files: [{ id: 7, name: 'doc.pdf', size: 5, type: 'application/pdf' }],
      targetFormat: 'docx',
    });
    await saveFileBytes(sid, 7, new Uint8Array([1, 1, 1, 1, 1]));
    const stored = (await loadSession<ConvertPagePayload>(sid))!;

    const state = { files: [] as any[], targetFormat: null as string | null };
    const p = track(createPersistor(makeSpec(state)));
    const ok = await p.resume(stored);
    expect(ok).toBe(true);
    expect(state.files[0].id).toBe(7);
    expect(getCurrentSessionId('convertPage')).toBe(sid);
  });

  it('clear() removes the session row, bytes, and sessionStorage entry', async () => {
    vi.useFakeTimers();
    try {
      const state = {
        files: [{ id: 0, name: 'a', size: 1, bytes: new Uint8Array([7]) }],
        targetFormat: null as string | null,
      };
      const p = track(createPersistor(makeSpec(state)));
      p.markFilesDirty();
      await vi.advanceTimersByTimeAsync(1500);
      const sid = getCurrentSessionId('convertPage')!;
      vi.useRealTimers();

      p.clear();
      // clear() schedules an async clearSession; await one microtask to settle.
      await new Promise(r => setTimeout(r, 50));
      expect(getCurrentSessionId('convertPage')).toBeNull();
      expect(await loadSession(sid)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('detects tab-clone and mints fresh sessionId when a sibling claims our sessionStorage id', async () => {
    const sharedId = 'shared-id';
    setStoredSessionId('convertPage', sharedId);
    await saveSession(sharedId, 'convertPage', {
      files: [{ id: 0, name: 'orig', size: 1 }],
      targetFormat: 'png',
    });
    await saveFileBytes(sharedId, 0, new Uint8Array([1]));

    const origState = { files: [] as any[], targetFormat: null as string | null };
    const orig = track(createPersistor(makeSpec(origState)));
    await orig.tryRestore();
    expect(getCurrentSessionId('convertPage')).toBe(sharedId);

    const cloneState = { files: [] as any[], targetFormat: null as string | null };
    const clone = track(createPersistor(makeSpec(cloneState)));
    const result = await clone.tryRestore();
    expect(result.status).toBe('none');
    const cloneSid = getCurrentSessionId('convertPage');
    expect(cloneSid).toBeTruthy();
    expect(cloneSid).not.toBe(sharedId);
  });
});
