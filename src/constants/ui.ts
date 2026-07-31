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

const GiB = 1024 * 1024 * 1024;

/**
 * Ceiling for a single file on the Compress surface.
 *
 * This is a real technical limit, not a policy one. The engines are 32-bit
 * WebAssembly builds with a 4 GiB address space, and they need working room
 * inside it for decode buffers on top of the file itself. Past roughly 2 GiB
 * the engine aborts rather than the browser, which surfaces as a failure with
 * no useful explanation - better to say so at the door.
 *
 * Note this is deliberately *not* the kind of quota a hosted tool imposes.
 * TinyPNG stops at 5 MB and CloudConvert at 1 GB because they pay for the
 * bandwidth and the CPU; nothing here leaves the machine, so the only question
 * is whether the tab survives.
 */
export const MAX_SINGLE_FILE_SIZE = 2 * GiB;

/** Past this, one file is worth a heads-up about time, not a refusal. */
export const LARGE_FILE_WARN_SIZE = 512 * 1024 * 1024;

/** `navigator.deviceMemory` is Chromium-only and quantised; Safari and Firefox
 *  report nothing, so most of the world lands on this. */
const FALLBACK_DEVICE_MEMORY_GB = 4;

/**
 * Total-bytes budget for a Compress batch, scaled to the device.
 *
 * Compress reads one file at a time (see `CompressInput.read`), so the batch
 * total no longer has to fit in memory all at once - what accumulates is the
 * *outputs*, and an output is smaller than its input or it is discarded. The
 * flat 500 MB cap predated that and was sized for the old load-everything-first
 * behaviour; it refused a single 800 MB video to guard against a batch of them.
 *
 * A quarter of device memory keeps headroom for the engine heap and the copy
 * `runInWorker` transfers, while landing at 2 GiB on an ordinary 8 GB machine -
 * four times what the surface allowed before, and enough for the large-video
 * case people actually arrive with.
 */
export function compressBatchBudget(): number {
    const deviceGB = (navigator as { deviceMemory?: number }).deviceMemory
        ?? FALLBACK_DEVICE_MEMORY_GB;
    const budget = deviceGB * 0.25 * GiB;
    // Floor so a phone reporting 0.5 GB still gets a usable surface; ceiling
    // because past this the browser's own allocator becomes the limit.
    return Math.max(GiB, Math.min(4 * GiB, budget));
}

// Hand-off from the Converter's same-format signpost to the Compress surface,
// carrying the files the user had already picked. A constant rather than a
// literal in both files, because a typo on either side fails silently: the
// event simply never arrives and the button looks broken.
export const COMPRESS_THESE_EVENT = "frog:compress-these";
