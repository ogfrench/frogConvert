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
