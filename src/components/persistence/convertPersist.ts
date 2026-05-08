// Persistence wiring for the Converter surface. Mirrors the inline persistor
// in PdfWorkspace.ts, sharing the same createPersistor factory.

import { createPersistor } from './createPersistor.ts';
import { clearSession, type ConvertPagePayload, type StoredSession } from './sessionStore.ts';
import { currentFiles, selectedToIndex, allOptionsRef } from '../store/store.ts';
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

export interface RestoreApplier {
  applyFiles: (files: File[]) => void;
  applyTargetFormat: (formatKey: string) => void;
}

let applier: RestoreApplier | null = null;

const persistor = createPersistor<ConvertPagePayload>({
  kind: 'convertPage',
  buildPayload: () => {
    const idx = selectedToIndex.value;
    const targetFormat = idx !== null && allOptionsRef.value[idx]
      ? allOptionsRef.value[idx].format.format
      : null;
    return {
      files: currentFiles.value.map(f => ({
        id: idFor(f),
        name: f.name,
        size: f.size,
        type: f.type,
        lastModified: f.lastModified,
      })),
      targetFormat,
    };
  },
  currentFileIds: () => currentFiles.value.map(idFor),
  getBytesForId: async (id) => {
    const f = currentFiles.value.find(x => idFor(x) === id);
    if (!f) throw new Error(`convertPersist: no file with id ${id}`);
    return new Uint8Array(await f.arrayBuffer());
  },
  isPristine: () => currentFiles.value.length === 0,
  applyPayload: (payload, bytesById) => {
    const missing = payload.files.filter(f => !bytesById.has(f.id));
    if (missing.length) {
      showToast('Saved session was incomplete and could not be restored.', 'warn', 6000);
      return false;
    }
    if (!applier) return false;
    const restored: File[] = payload.files.map(meta => {
      const bytes = bytesById.get(meta.id)!;
      // File constructor accepts BufferSource at runtime; TS demands an
      // ArrayBuffer-backed view. Cast is sound - bytes round-trip Uint8Array.
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
    applier.applyFiles(restored);
    if (payload.targetFormat) applier.applyTargetFormat(payload.targetFormat);
    return true;
  },
});

export const markConvertDirty = (scope: 'manifest' | 'files' = 'manifest') =>
  scope === 'files' ? persistor.markFilesDirty() : persistor.markManifestDirty();
export const flushConvertOnHide = () => persistor.flushOnHide();
export const clearConvertSession = () => persistor.clear();

function showResumePopup(stored: StoredSession<ConvertPagePayload>): void {
  const fc = stored.payload.files.length;
  const summary = fc === 1
    ? `1 file (${stored.payload.files[0].name})`
    : `${fc} files`;
  const targetHint = stored.payload.targetFormat
    ? ` → ${stored.payload.targetFormat.toUpperCase()}`
    : '';
  showConfirmPopup(
    'Resume your last conversion?',
    `${summary}${targetHint}`,
    { label: 'Resume', onClick: async () => {
      const ok = await persistor.resume(stored);
      if (ok) showToast('Conversion restored', 'info', 3000);
    }},
    { label: 'Start fresh', onClick: () => { void clearSession(stored.sessionId); } },
  );
}

export async function tryRestoreConvertSession(a: RestoreApplier): Promise<void> {
  applier = a;
  const result = await persistor.tryRestore();
  if (result.status === 'orphan') showResumePopup(result.stored);
}
