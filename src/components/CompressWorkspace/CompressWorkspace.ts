import "./CompressWorkspace.css";
import { showToast } from "../Toast/Toast.ts";
import { escapeHTML, formatBytes, shortenFileName } from "../utils/index.ts";
import { isTouchUi } from "../../core/utils/touchUi.ts";
import { ABSOLUTE_MAX_FILES, MAX_TOTAL_FILE_SIZE } from "../../constants/ui.ts";
import { allOptionsRef, compressLevel, setCompressLevel, COMPRESS_LEVEL_CHOICES, type CompressLevel } from "../store/store.ts";
import { findMatchingFormat } from "../../core/FormatHandler/detectFormat.ts";
import {
  compressBatch,
  totalSaved,
  type CompressInput,
  type CompressOutcome,
  type SkipReason,
} from "../../core/compression/compressBatch.ts";
import { runInWorker } from "../../conversion/workerClient.ts";
import {
  showConversionInProgress,
  ensureCancelButton,
  setActiveConversionMode,
  setCanHardCancel,
  setCurrentFileProgress,
  resetCancellation,
  completeCancellation,
  isCancelled,
} from "../../conversion/cancellation.ts";
import { hidePopup } from "../Popup/Popup.ts";
import { preloadGhostscript } from "../../tools/ghostscriptPreload.ts";
import { downloadFile, downloadAsZip, timestampForFilename } from "../../conversion/download.ts";
import { triggerConfetti } from "../../effects/Confetti/Confetti.ts";
import { createDancingFrog } from "../Frogsworth/DancingFrog.ts";
import {
  markCompressDirty,
  flushCompressOnHide,
  clearCompressSession,
  tryRestoreCompressSession,
} from "../persistence/compressPersist.ts";

/**
 * Compress workspace — the dedicated "make my files smaller" surface, a peer
 * of the Converter and the PDF Editor.
 *
 * Module-singleton like PdfWorkspace: state lives at module scope so switching
 * app modes preserves the user's batch. `cleanup()` tears down DOM only;
 * `resetAll()` is the destructive cousin.
 */

/**
 * This surface's own level, independent of the Converter's setting so neither
 * moves the other. Definition lives in the store so it can persist.
 *
 * NOTE the deliberate inversion: the engine's `low` preset means "low quality
 * target", i.e. the *most* aggressive compression, while `high` compresses the
 * least. So the shipped labels map:
 *   High quality -> high, Balanced -> medium, Smallest file -> low.
 */
export const COMPRESS_LEVELS = COMPRESS_LEVEL_CHOICES;

/** Matches the store's own default. Anything else and "reset" would quietly
 *  move the user somewhere a fresh install never puts them. */
export const DEFAULT_LEVEL: CompressLevel = "auto";

type Entry = { id: number; file: File };
type Phase = "idle" | "running" | "done";

let files: Entry[] = [];
let nextId = 1;
let initialized = false;

let phase: Phase = "idle";
/** Whether the file list under the drop zone is expanded (the "manage" toggle). */
let listOpen = false;
let results: CompressOutcome[] = [];
let progress = { done: 0, total: 0, current: "" };

let rootEl: HTMLElement | null = null;
let fileInput: HTMLInputElement | null = null;

/** Test seam + share-target entry point. */
export function getFiles(): readonly Entry[] { return files; }
export function getLevel(): CompressLevel { return compressLevel.value; }
export function getPhase(): Phase { return phase; }
export function getResults(): readonly CompressOutcome[] { return results; }

/**
 * Cheap intake filter. The authoritative "can this actually be compressed?"
 * check needs the loaded handler list and happens at compress time; here we
 * only keep obviously-wrong drops out of the batch.
 */
/** Some browsers hand over an empty type for a PDF picked from disk, so the
 *  name is the fallback. Shared by the intake filter and the engine preload. */
function isPdf(file: File): boolean {
  const mime = (file.type || "").toLowerCase();
  return mime === "application/pdf" || (!mime && /\.pdf$/i.test(file.name));
}

export function isLikelyCompressible(file: File): boolean {
  const mime = (file.type || "").toLowerCase();
  if (isPdf(file)) return true;
  // SVG is the one image type we know up front we will never compress — it's
  // vector text, and the only thing a raster compressor could do to it is
  // rasterise it. Better to say so on the drop than after a batch. Anything
  // else images-ish is let through and gets an honest per-file answer, because
  // over-rejecting here would turn files we *can* handle away at the door.
  if (mime === "image/svg+xml" || (!mime && /\.svgz?$/i.test(file.name))) return false;
  return mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/");
}

export function handleFiles(incoming: File[]) {
  if (!incoming.length) return;

  const accepted = incoming.filter(isLikelyCompressible);
  const rejected = incoming.length - accepted.length;
  if (rejected > 0) {
    showToast(
      rejected === incoming.length
        ? "Nothing there i can compress. Images, audio, video and PDFs."
        : `Skipped ${rejected} file${rejected === 1 ? "" : "s"} i can't compress yet.`,
      "warn",
      8000,
    );
  }
  if (!accepted.length) return;

  const roomLeft = ABSOLUTE_MAX_FILES - files.length;
  if (roomLeft <= 0) {
    showToast(`That's the ${ABSOLUTE_MAX_FILES}-file ceiling. Compress these first.`, "warn", 8000);
    return;
  }
  const withinCount = accepted.slice(0, roomLeft);
  if (withinCount.length < accepted.length) {
    showToast(`Only took the first ${withinCount.length}. That's the ${ABSOLUTE_MAX_FILES}-file ceiling.`, "warn", 8000);
  }

  let total = files.reduce((sum, e) => sum + e.file.size, 0);
  const withinBudget: File[] = [];
  for (const f of withinCount) {
    if (total + f.size > MAX_TOTAL_FILE_SIZE) {
      showToast(`Batch caps out at ${formatBytes(MAX_TOTAL_FILE_SIZE)}. Some files didn't make it.`, "warn", 8000);
      break;
    }
    total += f.size;
    withinBudget.push(f);
  }
  if (!withinBudget.length) return;

  // Dropping onto a finished batch means starting a new one; without this the
  // results view stays up and the added files are invisible.
  if (phase === "done") {
    phase = "idle";
    results = [];
  }

  for (const file of withinBudget) files.push({ id: nextId++, file });
  // A PDF in the batch means the 16 MB engine is on the critical path of the
  // Compress button. Start fetching it while the user is still adding files.
  if (withinBudget.some(isPdf)) preloadGhostscript();
  markCompressDirty("files");
  render();
}

function removeFile(id: number) {
  files = files.filter(e => e.id !== id);
  markCompressDirty("files");
  render();
}

// --- Running a batch ---

/** Typed against SkipReason so a new reason can't be added without copy. */
const REASON_COPY: Record<SkipReason, string> = {
  "already-minimal": "already compressed",
  "no-gain": "no gain",
  "unsupported": "can't compress this",
  "failed": "failed",
  "cancelled": "stopped",
};

export async function runCompression() {
  if (phase === "running" || !files.length) return;

  // Landing straight on /compress can beat the handler registry loading. With
  // an empty option list every file fails format detection and would be
  // reported "can't compress this", which is a lie about the file.
  if (!allOptionsRef.value.length) {
    showToast("Still warming up the engines. Give me a second.", "info", 5000);
    return;
  }

  // Progress belongs in the same modal the Converter and the PDF editor use.
  // Compress used to paint its own bar inside the card, which meant the one
  // surface whose work takes longest was the one that looked like nothing was
  // happening. The shared modal already knows how to say all of this in
  // compress vocabulary — see `modeCopy()` — and it brings the cancel button,
  // the escape-key binding and the "finishing this file" copy with it.
  resetCancellation();
  setActiveConversionMode("compress");
  // Stop means stop. Every engine Compress dispatches to runs in the shared
  // worker, so cancelling terminates it and the in-flight file is abandoned
  // rather than finished. Waiting was only ever an implementation detail of
  // the batch loop, and "finishing this file" can be many minutes on a large
  // video — the one case where someone is most likely to want out.
  //
  // The one exception is the canvas PDF fallback, which is main-thread and
  // cannot be interrupted; it only runs when Ghostscript is unreachable, and
  // the shared hard-cancel watchdog force-closes the UI if it does not yield.
  // Files never reached are reported *stopped*, never *failed*.
  setCanHardCancel(true);
  setCurrentFileProgress(0, files.length);

  phase = "running";
  progress = { done: 0, total: files.length, current: "" };
  render();

  showConversionInProgress(
    `Reading your ${files.length > 1 ? "files" : "file"}...`
    + `<br><span class="conversion-path">getting ready to compress</span>`,
    progressTitle(),
    "idle",
  );
  ensureCancelButton();

  const options = allOptionsRef.value;
  const outcomes: (CompressOutcome | null)[] = files.map(() => null);
  const recognized: CompressInput[] = [];
  const recognizedAt: number[] = [];
  let celebrate = false;

  // Anything from here on has to leave `phase` somewhere the user can act
  // from. Without this the surface can strand itself on "Compressing…" with no
  // way back but a reload — and `file.arrayBuffer()` really does reject when
  // a picked file is moved or deleted before the batch runs.
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i].file;
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch (e) {
        // One unreadable file shouldn't take the batch down with it.
        console.error("[compress] couldn't read", file.name, e);
        outcomes[i] = {
          name: file.name, bytes: new Uint8Array(0), originalSize: file.size,
          shrunk: false, reason: "failed",
        };
        continue;
      }
      const idx = findMatchingFormat([file], options);
      if (idx < 0) {
        // Handlers may still be loading, or it's genuinely a format we don't know.
        outcomes[i] = {
          name: file.name, bytes, originalSize: bytes.byteLength,
          shrunk: false, reason: "unsupported",
        };
        continue;
      }
      recognizedAt.push(i);
      recognized.push({ name: file.name, bytes, format: options[idx].format });
    }

    const alreadyDone = files.length - recognized.length;
    const batch = await compressBatch(recognized, {
      options,
      level: compressLevel.value,
      run: runInWorker,
      onProgress: (done, _total, current) => {
        progress = { done: alreadyDone + done, total: files.length, current };
        paintProgress();
      },
      isCancelled: () => isCancelled,
    });

    batch.forEach((outcome, k) => { outcomes[recognizedAt[k]] = outcome; });
    results = outcomes.filter((o): o is CompressOutcome => o !== null);
    celebrate = results.some(r => r.shrunk);
  } catch (e) {
    console.error("[compress] batch threw", e);
    showToast("Something went wrong while compressing. Your files are untouched.", "error", 8000);
    // Back to the file list rather than an empty results view: the batch is
    // still there and re-running it is the obvious next move.
    phase = "idle";
    results = [];
    render();
    return;
  } finally {
    if (phase === "running") phase = "done";
    // Whatever happened, the modal comes down. Split from the state reset the
    // same way the conversion flow splits it: `completeCancellation` awaits a
    // minimum on-screen time for the cancel copy and can therefore throw or
    // stall, and the popup must close regardless.
    try {
      await completeCancellation(true);
    } catch (err) {
      console.error("[compress] cancel cleanup failed:", err);
    }
    hidePopup();
    resetCancellation();
  }

  render();
  // After the paint, not before: firing it while the progress card is still
  // on screen celebrates a result the user cannot see yet.
  if (celebrate) triggerConfetti();
}

/** Mirrors the Converter's "Converting your files" heading. */
function progressTitle(): string {
  return `Compressing your ${progress.total > 1 ? "files" : "file"}`;
}

/**
 * Push per-file progress into the shared modal. `showConversionInProgress`
 * diffs its own content, so calling it per file is cheap, and it declines to
 * overwrite the cancel copy once Stop has been pressed.
 */
function paintProgress() {
  // `done` counts finished files; the one being worked on is the next one up.
  const current = Math.min(progress.done + 1, progress.total);
  // Keeps the shared cancel copy able to say "Finishing file 2 of 3".
  setCurrentFileProgress(current, progress.total);

  const main = progress.total > 1
    ? `Compressing file ${current} of ${progress.total}...`
    : "Compressing your file...";
  const detail = progress.current
    ? `<br><span class="conversion-path">${escapeHTML(shortenFileName(progress.current, 32))}</span>`
    : "";
  showConversionInProgress(`${main}${detail}`, progressTitle());
}

/**
 * "photo.png" -> "photo-compressed.png".
 *
 * Downloading a compressed copy under its original name lands next to the
 * original as "photo (1).png", and now nothing says which of the two is the
 * small one. The suffix makes the download self-describing, the same answer
 * iLoveIMG and friends settled on. Only *shrunk* files get it: a file that
 * passed through untouched is the original, and labelling original bytes
 * "-compressed" would be a lie. Applied at download time, not in the results
 * list, so the on-screen rows still match the names the user dropped.
 */
export function compressedName(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  // Re-compressing an already-suffixed download must not stack suffixes.
  if (stem.endsWith("-compressed")) return name;
  return `${stem}-compressed${ext}`;
}

export async function downloadResults() {
  if (!results.length) return;
  // A file we could not even read has no bytes to give back. Shipping a 0-byte
  // file under the original name looks like the compressor destroyed it, which
  // is worse than it simply not being in the archive.
  const out = results
    .filter(r => !(r.bytes.byteLength === 0 && r.originalSize > 0))
    .map(r => ({ name: r.shrunk ? compressedName(r.name) : r.name, bytes: r.bytes }));
  if (!out.length) {
    showToast("Nothing to download. None of those files could be read.", "warn", 6000);
    return;
  }
  if (out.length === 1) downloadFile(out[0].bytes, out[0].name);
  else await downloadAsZip(out, `compressed-${timestampForFilename()}.zip`);
}

/** Back to the batch view, keeping the files so a different level can be tried. */
export function backToFiles() {
  phase = "idle";
  results = [];
  render();
}

// --- Rendering ---

/**
 * The whole idle view, deliberately mirroring the convert card: same
 * `.convert-field` wrappers, the same `.upload-zone` drop target with its
 * file-info row and action buttons, and `.format-selector` for the level.
 * Reusing those classes means this surface inherits the Converter's look and
 * every future tweak to it, instead of drifting into a lookalike.
 */
function uploadFieldMarkup(): string {
  const hint = isTouchUi() ? "or tap to browse" : "or click to browse";
  const total = files.reduce((sum, e) => sum + e.file.size, 0);
  const hasFiles = files.length > 0;
  const label = hasFiles
    ? `${files.length} file${files.length === 1 ? "" : "s"} ready · ${formatBytes(total)}`
    : "";
  const displayName = files.length === 1
    ? shortenFileName(files[0].file.name, 32)
    : `${files.length} files selected`;

  return `
    <div class="convert-field">
      <span class="field-label">${escapeHTML(label)}</span>
      <div class="upload-zone ${hasFiles ? "has-file" : ""}" role="button" tabindex="0"
        aria-label="Drop files to compress">
        <p class="upload-text" ${hasFiles ? 'style="display:none"' : ""}>Drop your files</p>
        <p class="upload-hint" ${hasFiles ? 'style="display:none"' : ""}>${hint}</p>
        <div class="upload-file-info ${hasFiles ? "visible" : ""}" aria-live="polite" aria-atomic="true">
          <span class="upload-file-name truncate">${escapeHTML(displayName)}</span>
          <div class="upload-file-actions">
            <button class="upload-action-btn icon-btn floating-card-surface cw-manage" type="button"
              title="Manage files" aria-label="Manage files">&#9776;</button>
            <button class="upload-action-btn icon-btn floating-card-surface cw-replace" type="button"
              title="Add more files" aria-label="Add more files">&#8635;</button>
            <button class="upload-action-btn icon-btn floating-card-surface cw-clear" type="button"
              title="Remove all files" aria-label="Remove all files">&times;</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function levelFieldMarkup(): string {
  const current = compressLevel.value;
  const active = COMPRESS_LEVELS.find(l => l.value === current);
  const options = COMPRESS_LEVELS.map(l => `
    <button class="cw-level-option" type="button" role="menuitem" data-level="${l.value}"
      aria-current="${l.value === current}">
      <span>${escapeHTML(l.label)}</span>
      <span class="cw-level-blurb">${escapeHTML(l.blurb)}</span>
    </button>
  `).join("");

  return `
    <div class="convert-field cw-level-field">
      <span class="convert-to-label">Compression level</span>
      <button class="format-selector has-value cw-level-selector" type="button"
        aria-haspopup="menu" aria-expanded="false">
        <span class="selector-text truncate">${escapeHTML(active?.label ?? "Automatic")}</span>
        <span class="selector-chevron" aria-hidden="true">&#9662;</span>
      </button>
      <div class="cw-level-menu" role="menu" aria-label="Compression level" hidden>${options}</div>
    </div>
  `;
}

function fileListMarkup(): string {
  const rows = files.map(e => `
    <li class="cw-row" data-id="${e.id}">
      <span class="cw-row-name" title="${escapeHTML(e.file.name)}">${escapeHTML(shortenFileName(e.file.name, 40))}</span>
      <span class="cw-row-size">${formatBytes(e.file.size)}</span>
      <button class="cw-row-remove" type="button" data-remove="${e.id}"
        aria-label="Remove ${escapeHTML(e.file.name)}">&times;</button>
    </li>
  `).join("");
  return `<ul class="cw-list" ${listOpen ? "" : "hidden"}>${rows}</ul>`;
}

function resultsMarkup(): string {
  const saved = totalSaved(results);
  const originalTotal = results.reduce((sum, r) => sum + r.originalSize, 0);
  const pct = originalTotal ? Math.round((saved / originalTotal) * 100) : 0;
  const shrunkCount = results.filter(r => r.shrunk).length;

  // "Already as small as they get" is only true when we actually tried. If
  // every file was a format we cannot compress, saying that is a lie about
  // the files — the honest answer is that we could not help.
  const noneSupported = results.length > 0 && results.every(r => r.reason === "unsupported");
  // Stopping early leaves files untouched by request, not by failure. Saying
  // "nothing left to shave off" about files we never opened is just untrue.
  const stoppedCount = results.filter(r => r.reason === "cancelled").length;

  // A real saving that rounds to 0% ("saved 60 KB of 400 MB") reads as a bug.
  const pctText = pct > 0 ? `${pct}% smaller` : "under 1% smaller";

  const headline = saved > 0
    ? `Saved ${formatBytes(saved)} <span class="cw-pct">(${pctText})</span>`
    : stoppedCount > 0
      ? `Stopped`
      : noneSupported
        ? `Nothing i can compress here`
        : `Nothing left to shave off`;
  const sub = saved > 0
    ? stoppedCount > 0
      ? `${shrunkCount} file${shrunkCount === 1 ? "" : "s"} got smaller before you stopped. The rest are untouched.`
      : `${shrunkCount} of ${results.length} file${results.length === 1 ? "" : "s"} got smaller.`
    : stoppedCount > 0
      ? `Stopped before anything got smaller. Your files are untouched.`
      : noneSupported
        ? `These formats aren't ones i can compress. Images, audio, video and PDFs are.`
        : `These were already as small as they usefully get.`;

  const rows = results.map(r => {
    const detail = r.shrunk
      ? `<span class="cw-res-from">${formatBytes(r.originalSize)}</span>
         <span class="cw-res-arrow" aria-hidden="true">→</span>
         <span class="cw-res-to">${formatBytes(r.bytes.byteLength)}</span>
         <span class="cw-res-pct">−${Math.round((1 - r.bytes.byteLength / r.originalSize) * 100)}%</span>`
      : `<span class="cw-res-from">${formatBytes(r.originalSize)}</span>
         <span class="cw-res-note">${escapeHTML(REASON_COPY[r.reason ?? "no-gain"] ?? "unchanged")}</span>`;
    return `
      <li class="cw-res-row ${r.shrunk ? "shrunk" : "kept"}">
        <span class="cw-row-name" title="${escapeHTML(r.name)}">${escapeHTML(shortenFileName(r.name, 36))}</span>
        <span class="cw-res-detail">${detail}</span>
      </li>
    `;
  }).join("");

  // A PDF that came back no smaller has two quite different explanations and
  // we cannot tell them apart from here, so the note names both rather than
  // asserting the one that happens to be wrong. Measured: a 71-page,
  // image-heavy research brief *grew* 42% at "Smallest file" because its
  // JPEG2000 images get decoded and re-encoded, then shrank 18% at
  // "High quality" - the opposite of what the old copy would have told that
  // user, which was that their document must be mostly text.
  const stubbornPdf = results.some(r =>
    !r.shrunk && r.reason === "no-gain" && /\.pdf$/i.test(r.name));
  const pdfNote = stubbornPdf
    ? `<p class="cw-results-note">That PDF didn't get smaller. Either it's mostly text, which is fonts and vector shapes rather than images, or its images are already stored in a format this level would have had to make bigger. Trying a different level is worth a go: on some documents <b>High quality</b> saves more than <b>Smallest file</b>.</p>`
    : "";

  // A degraded route ran because the real engine was unreachable. This is a
  // saving the user did not ask for the cost of, so it is stated plainly
  // rather than folded into the cheerful savings headline. De-duplicated: one
  // warning per distinct cause, not one per file.
  const warnings = [...new Set(results.map(r => r.warning).filter(Boolean) as string[])];
  const warningNotes = warnings
    .map(w => `<p class="cw-results-warning">${escapeHTML(w)}</p>`)
    .join("");

  return `
    <div class="cw-results-card">
      <div class="cw-results-head" role="status" aria-live="polite" aria-atomic="true">
        ${saved > 0 ? `<div class="cw-results-frog" aria-hidden="true"></div>` : ""}
        <p class="cw-results-headline">${headline}</p>
        <p class="cw-results-sub">${escapeHTML(sub)}</p>
        ${warningNotes}
        ${pdfNote}
      </div>
      <ul class="cw-results-list">${rows}</ul>
      <div class="cw-results-actions">
        <button class="cw-download" type="button">
          ${results.length === 1 ? "Download" : "Download all (.zip)"}
        </button>
        <button class="cw-back" type="button">Try another level</button>
      </div>
    </div>
  `;
}

// The privacy promise deliberately lives in #compress-description, the page
// line below the card, and not here as well. This surface used to state it
// twice in a row — "Nothing leaves your device" immediately above "without
// sending them anywhere" — which reads as padding rather than reassurance.
// One line, in the same place the Converter and PDF Editor put theirs.

function actionMarkup(): string {
  return `
    <button class="cw-compress btn-primary" type="button">
      Compress ${files.length} file${files.length === 1 ? "" : "s"}
    </button>
  `;
}

function render() {
  if (!rootEl) return;
  // "running" deliberately has no view of its own. The progress modal is up
  // and blocking, and the card behind it stays on the file list, so pressing
  // Stop reveals the batch exactly where it was rather than a dead panel.
  if (phase === "done") {
    rootEl.innerHTML = resultsMarkup();
  } else {
    rootEl.innerHTML = files.length
      ? `${uploadFieldMarkup()}${fileListMarkup()}${levelFieldMarkup()}${actionMarkup()}`
      : uploadFieldMarkup();
  }
  wireRendered();
}

/** Everything this surface takes, and the picker filter for each. Empty accept
 *  means "all of the above", which is the input's own markup default. */
const ALL_ACCEPT = "image/*,audio/*,video/*,application/pdf,.pdf";

function openPicker(accept = "") {
  if (!fileInput) return;
  fileInput.multiple = true;
  fileInput.accept = accept || ALL_ACCEPT;
  fileInput.click();
}

/**
 * Escape closes the level dropdown, wherever focus happens to be.
 *
 * Module-scoped on purpose: `wireRendered()` runs on every render, and
 * `addEventListener` with an identical function reference is a no-op, so this
 * cannot stack up on `document` the way an inline closure would. It looks the
 * menu up per press rather than closing over it, so a re-render replacing the
 * element does not leave it pointing at a detached node.
 */
function onLevelMenuEscape(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  const menu = rootEl?.querySelector<HTMLElement>(".cw-level-menu");
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  const selector = rootEl?.querySelector<HTMLElement>(".cw-level-selector");
  selector?.setAttribute("aria-expanded", "false");
  // Focus goes back where it came from, so keyboard users are not dropped at
  // the top of the document.
  selector?.focus();
}

function wireRendered() {
  if (!rootEl) return;

  const zone = rootEl.querySelector<HTMLElement>(".upload-zone");
  if (zone) {
    zone.addEventListener("click", (e) => {
      // The action buttons sit inside the zone; don't let them open the picker.
      if ((e.target as HTMLElement).closest(".upload-file-actions")) return;
      openPicker();
    });
    zone.addEventListener("keydown", (e) => {
      if (e.key !== " " && e.key !== "Enter") return;
      e.preventDefault();
      openPicker();
    });
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      handleFiles(Array.from(e.dataTransfer?.files ?? []));
    });
  }

  rootEl.querySelector<HTMLElement>(".cw-manage")?.addEventListener("click", (e) => {
    e.stopPropagation();
    listOpen = !listOpen;
    render();
  });
  rootEl.querySelector<HTMLElement>(".cw-replace")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openPicker();
  });
  rootEl.querySelector<HTMLElement>(".cw-clear")?.addEventListener("click", (e) => {
    e.stopPropagation();
    files = [];
    listOpen = false;
    markCompressDirty("files");
    render();
  });

  for (const btn of rootEl.querySelectorAll<HTMLElement>("[data-remove]")) {
    btn.addEventListener("click", () => removeFile(Number(btn.dataset.remove)));
  }

  // Level selector: same dropdown contract as the format picker it mirrors.
  const levelSelector = rootEl.querySelector<HTMLElement>(".cw-level-selector");
  const levelMenu = rootEl.querySelector<HTMLElement>(".cw-level-menu");
  if (levelSelector && levelMenu) {
    const setOpen = (open: boolean) => {
      levelMenu.hidden = !open;
      levelSelector.setAttribute("aria-expanded", String(open));
    };
    levelSelector.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(levelMenu.hidden);
    });
    levelMenu.addEventListener("click", (e) => {
      const opt = (e.target as HTMLElement).closest(".cw-level-option") as HTMLElement | null;
      if (!opt) return;
      setOpen(false);
      const next = opt.dataset.level as CompressLevel;
      if (next === compressLevel.value) return;
      setCompressLevel(next);
      markCompressDirty("manifest");
      render();
      // Mirror into the settings menu, which shows this same setting.
      window.dispatchEvent(new CustomEvent("frog:compress-level", { detail: { from: "card" } }));
    });
    // Escape is bound at document level, not on the menu. Opening the dropdown
    // leaves focus on the *trigger*, so a keydown listener on the menu only
    // fired once the user had already arrowed into it — meaning Escape did
    // nothing in the ordinary case of "I opened this by mistake".
    //
    // That is worse than it sounds on a narrow screen: the menu overlays the
    // Compress button, and a click aimed at the button lands on the menu (which
    // is inside `.cw-level-field`, so the click-away handler ignores it too).
    // With no working Escape, the surface was effectively stuck until the user
    // guessed to tap elsewhere.
    document.addEventListener("keydown", onLevelMenuEscape);
    // Click-away is handled once at init, not here: wireRendered() runs on
    // every render and a listener added per render piles up on `document`.
  }

  rootEl.querySelector<HTMLElement>(".cw-compress")?.addEventListener("click", () => { void runCompression(); });
  // The same celebration the Converter puts on its success popup. Compress
  // keeps its numbers in the card rather than a modal - the per-file table and
  // "try another level" are the point, and a popup would cover them - so the
  // frog comes to the card instead of the card moving into a popup.
  const frogSlot = rootEl.querySelector<HTMLElement>(".cw-results-frog");
  if (frogSlot && !frogSlot.firstChild) frogSlot.appendChild(createDancingFrog());

  rootEl.querySelector<HTMLElement>(".cw-download")?.addEventListener("click", () => { void downloadResults(); });
  rootEl.querySelector<HTMLElement>(".cw-back")?.addEventListener("click", backToFiles);
  // Stop lives on the progress modal now (ensureCancelButton), which also
  // binds Escape to it, so there is no cancel control to wire here.
}

// --- Lifecycle (mirrors PdfWorkspace) ---

export function initCompressWorkspace() {
  if (initialized) {
    resolveRefs();
    wireCategoryTabs();
    render();
    return;
  }
  initialized = true;
  resolveRefs();
  wireCategoryTabs();

  // Async and non-blocking: the empty state paints first when no session exists.
  void tryRestoreCompressSession({
    getFiles: () => files.map(e => e.file),
    getLevel: () => compressLevel.value,
    applyRestored: (restored, restoredLevel) => {
      files = restored.map(file => ({ id: nextId++, file }));
      // "auto" belongs in this list: it is the default, so leaving it out meant
      // the one level most sessions are saved with was never restored.
      if (restoredLevel === "auto" || restoredLevel === "high"
        || restoredLevel === "medium" || restoredLevel === "low") {
        setCompressLevel(restoredLevel);
      }
      phase = "idle";
      results = [];
      render();
    },
  });

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void flushCompressOnHide();
    });
    // One click-away listener for the lifetime of the surface. It looks the
    // menu up per click rather than closing over it, so re-renders replacing
    // the element don't need a fresh listener each time.
    document.addEventListener("click", (e) => {
      const menu = rootEl?.querySelector<HTMLElement>(".cw-level-menu");
      if (!menu || menu.hidden) return;
      if ((e.target as HTMLElement).closest(".cw-level-field")) return;
      menu.hidden = true;
      rootEl?.querySelector(".cw-level-selector")?.setAttribute("aria-expanded", "false");
    });
  }
  // pagehide covers the mobile / OS-killed-tab cases visibilitychange misses.
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => { void flushCompressOnHide(); });
    // The settings menu shows the same level as the card's own picker. Repaint
    // when it changes there, so the two views never disagree. Events the card
    // raised itself are ignored — it has already rendered.
    window.addEventListener("frog:compress-level", (e) => {
      if ((e as CustomEvent).detail?.from === "card") return;
      if (rootEl) render();
    });
  }

  fileInput?.addEventListener("change", () => {
    if (!fileInput?.files) return;
    handleFiles(Array.from(fileInput.files));
    fileInput.value = "";
  });

  wireCategoryTabs();
  render();
}

function resolveRefs() {
  rootEl = document.getElementById("compress-content");
  fileInput = document.getElementById("compress-file-input") as HTMLInputElement | null;
}

/**
 * The category pills above the card. On the Converter they filter a format
 * list; there is no such list here, so they do the job the user actually came
 * for — they state what this surface accepts, and tapping one opens the picker
 * already narrowed to that kind of file. Wired once at init: they live outside
 * `#compress-content` and so survive every re-render.
 */
function wireCategoryTabs() {
  const tabs = document.getElementById("compress-category-tabs");
  // The guard lives on the element, not in a module flag: a module flag would
  // skip re-wiring if the markup were ever replaced, and would still
  // double-wire a fresh element. This is idempotent either way.
  if (!tabs || tabs.dataset.wired === "1") return;
  tabs.dataset.wired = "1";
  tabs.addEventListener("click", (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>(".cat-tab");
    if (!tab) return;
    for (const t of tabs.querySelectorAll<HTMLElement>(".cat-tab")) {
      const active = t === tab;
      t.classList.toggle("active", active);
      t.setAttribute("aria-pressed", String(active));
    }
    openPicker(tab.dataset.accept ?? "");
  });
}

/** Tear down DOM refs but keep the user's batch, so mode switches don't lose work. */
export function cleanup() {
  rootEl = null;
}

/** Destructive reset — clears the batch and the chosen level. */
export function resetAll() {
  files = [];
  setCompressLevel(DEFAULT_LEVEL);
  phase = "idle";
  results = [];
  void clearCompressSession();
  if (rootEl) render();
}

/** Share-target / launch-queue entry point. */
export function ingestExternalFiles(incoming: File[]) {
  if (!initialized) initCompressWorkspace();
  handleFiles(incoming);
}
