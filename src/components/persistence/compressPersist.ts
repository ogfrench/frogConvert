// Persistence wiring for the Compress surface. Same shape as convertPersist,
// sharing the createPersistor factory; the payload carries the chosen level
// instead of a target format.

import { createPersistor } from './createPersistor.ts';
import { clearSession, type CompressPagePayload, type StoredSession } from './sessionStore.ts';
import { showToast } from '../Toast/Toast.ts';
import { showConfirmPopup } from '../Popup/Popup.ts';

const fileIdMap = new WeakMap<File, number>();
let nextLocalId = 0;

function idFor(f: File): number {
  let id = fileIdMap.get(f);
  if (id === undefined) {
    id = nextLocalId++;
    fileIdMap.set(f, id);
  }
  return id;
}

/**
 * The workspace owns its state, so the persistor reads through these rather
 * than importing the component (which would be a cycle).
 */
export interface CompressSource {
  getFiles: () => File[];
  getLevel: () => string;
  applyRestored: (files: File[], level: string) => void;
}

let source: CompressSource | null = null;

const persistor = createPersistor<CompressPagePayload>({
  kind: 'compressPage',
  buildPayload: () => ({
    files: (source?.getFiles() ?? []).map(f => ({
      id: idFor(f),
      name: f.name,
      size: f.size,
      type: f.type,
      lastModified: f.lastModified,
    })),
    level: source?.getLevel() ?? 'medium',
  }),
  currentFileIds: () => (source?.getFiles() ?? []).map(idFor),
  getBytesForId: async (id) => {
    const f = (source?.getFiles() ?? []).find(x => idFor(x) === id);
    if (!f) throw new Error(`compressPersist: no file with id ${id}`);
    return new Uint8Array(await f.arrayBuffer());
  },
  isPristine: () => (source?.getFiles() ?? []).length === 0,
  applyPayload: (payload, bytesById) => {
    const missing = payload.files.filter(f => !bytesById.has(f.id));
    if (missing.length) {
      showToast('Saved session was incomplete and could not be restored.', 'warn', 6000);
      return false;
    }
    if (!source) return false;
    const restored: File[] = payload.files.map(meta => {
      const bytes = bytesById.get(meta.id)!;
      // Same cast as convertPersist: File accepts BufferSource at runtime.
      const f = new File([bytes as BlobPart], meta.name, {
        type: meta.type ?? 'application/octet-stream',
        lastModified: meta.lastModified ?? Date.now(),
      });
      fileIdMap.set(f, meta.id);
      return f;
    });
    if (restored.length > 0) {
      nextLocalId = Math.max(...payload.files.map(f => f.id)) + 1;
    }
    source.applyRestored(restored, payload.level);
    return true;
  },
});

export const markCompressDirty = (scope: 'manifest' | 'files' = 'manifest') =>
  scope === 'files' ? persistor.markFilesDirty() : persistor.markManifestDirty();
export const flushCompressOnHide = () => persistor.flushOnHide();
export const clearCompressSession = () => persistor.clear();

function showResumePopup(stored: StoredSession<CompressPagePayload>): void {
  const fc = stored.payload.files.length;
  const summary = fc === 1
    ? `1 file (${stored.payload.files[0].name})`
    : `${fc} files`;
  showConfirmPopup(
    'Pick up where you left off?',
    `${summary} waiting to be squished`,
    { label: 'Resume', onClick: async () => {
      const ok = await persistor.resume(stored);
      if (ok) showToast('Batch restored', 'info', 3000);
    }},
    { label: 'Start fresh', onClick: () => { void clearSession(stored.sessionId); } },
  );
}

export async function tryRestoreCompressSession(s: CompressSource): Promise<void> {
  source = s;
  const result = await persistor.tryRestore();
  if (result.status === 'orphan') showResumePopup(result.stored);
}
