// Shared between the SW (writer) and the page (reader). Keep this file
// import-free of any browser-only globals so both contexts can use it.
//
// Numeric caps are imported from constants/ui.ts so share-target uses the
// same budget as the rest of the app instead of inventing share-only numbers.

import { ABSOLUTE_MAX_FILES, MAX_TOTAL_FILE_SIZE } from '../constants/ui.ts';

export const SHARE_TARGET_CACHE = 'share-target-files-v1';
export const SHARE_TARGET_PATH = '/?share-target=1';
export const SHARE_TARGET_READY_PATH = '/?share-target=ready';

// File-count + total-bytes caps mirror the converter / PDF Workspace.
// No per-file cap: the running-total cap already covers a single huge share
// (one 600 MB file fails the 500 MB total just as cleanly as a per-file cap).
export const SHARE_TARGET_MAX_FILES = ABSOLUTE_MAX_FILES;
export const SHARE_TARGET_MAX_TOTAL_BYTES = MAX_TOTAL_FILE_SIZE;

// CustomEvent shareTarget.ts emits and main.ts listens for. Single source so
// a typo in one half can't silently lose shared files.
export const EXTERNAL_FILES_EVENT = 'frog:external-files';

export interface ExternalFilesDetail { files: File[] }
