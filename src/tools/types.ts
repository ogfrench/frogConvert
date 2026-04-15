let nextFileId = 0;

export function getNextFileId(): number {
  return nextFileId++;
}

/** Minimal page manifest entry consumed by pdf-lib tools. No UI fields. */
export interface CorePageEntry {
  type: 'source' | 'blank';
  /** Stable ID matching CoreSourceFile.id. -1 for blank pages. */
  sourceFileId: number;
  /** 1-indexed page number in the original PDF. 0 for blank pages. */
  sourcePageNum: number;
  rotation: 0 | 90 | 180 | 270;
  blankPageSize?: { width: number; height: number };
}

/** PageEntry with UI-only fields layered on top. Used by PdfWorkspace. */
export interface PageEntry extends CorePageEntry {
  thumbnail: string | null;
  /** 1-indexed position when first added to the organize view. Used for badge arrows. */
  originalPos?: number;
}

/** Minimal source file consumed by pdf-lib tools. No UI fields. */
export interface CoreSourceFile {
  /** Stable unique ID assigned via getNextFileId(). */
  id: number;
  name: string;
  bytes: Uint8Array;
}

/** SourceFile with UI-only metadata layered on top. Used by PdfWorkspace. */
export interface SourceFile extends CoreSourceFile {
  size: number;
  pageCount: number;
  firstPageThumb: string | null;
}
