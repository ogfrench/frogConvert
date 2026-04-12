let nextFileId = 0;

export function getNextFileId(): number {
  return nextFileId++;
}

export interface PageEntry {
  /** 'source' for pages copied from a PDF, 'blank' for inserted blank pages. */
  type: 'source' | 'blank';
  /** Stable ID matching SourceFile.id — not an array index. -1 for blank pages. */
  sourceFileId: number;
  /** 1-indexed page number in the original PDF. 0 for blank pages. */
  sourcePageNum: number;
  /** data:image/png URL, null while loading. */
  thumbnail: string | null;
  /** Whether this page has been marked for deletion. */
  deleted: boolean;
  /** Clockwise rotation applied by the user (additive to any existing page rotation). */
  rotation: 0 | 90 | 180 | 270;
  /** Dimensions in PDF points for blank pages. */
  blankPageSize?: { width: number; height: number };
}

export interface SourceFile {
  /** Stable unique ID assigned via getNextFileId(). */
  id: number;
  name: string;
  size: number;
  bytes: Uint8Array;
  pageCount: number;
  /** Thumbnail of the first page, for file-view cards. */
  firstPageThumb: string | null;
}
