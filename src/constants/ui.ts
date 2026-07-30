export const DEFAULT_UPLOAD_TEXT = "Drop your files";
export const DEFAULT_UPLOAD_LABEL = "";
export const FILES_PER_PAGE = 20;

export const PARALLAX_MAX_DIST = 600;
export const PARALLAX_STRENGTH = 15;
export const MOBILE_BREAKPOINT = 800;

export const ABSOLUTE_MAX_FILES = 300;

// App-wide total-bytes budget for any user-facing batch (PDF Workspace upload,
// share-target ingestion). Single source so deploys can't drift between
// surfaces. PDF Workspace uses this for its 500 MB batch cap; share-target
// uses it as the running-total cap inside the SW.
export const MAX_TOTAL_FILE_SIZE = 500 * 1024 * 1024;

// Hand-off from the Converter's same-format signpost to the Compress surface,
// carrying the files the user had already picked. A constant rather than a
// literal in both files, because a typo on either side fails silently: the
// event simply never arrives and the button looks broken.
export const COMPRESS_THESE_EVENT = "frog:compress-these";
