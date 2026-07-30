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
} from "../../core/compression/compressBatch.ts";
import { runInWorker } from "../../conversion/workerClient.ts";
import { downloadFile, downloadAsZip, timestampForFilename } from "../../conversion/download.ts";
import { triggerConfetti } from "../../effects/Confetti/Confetti.ts";
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
 * least. Less -> high, Recommended -> medium, Extreme -> low.
 */
export const COMPRESS_LEVELS = COMPRESS_LEVEL_CHOICES;

export const DEFAULT_LEVEL: CompressLevel = "medium";

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
let cancelRequested = false;

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
export function isLikelyCompressible(file: File): boolean {
  const mime = (file.type || "").toLowerCase();
  if (mime === "application/pdf") return true;
  // Some browsers hand over an empty type for a PDF picked from disk.
  if (!mime && /\.pdf$/i.test(file.name)) return true;
  return mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/");
}

export function handleFiles(incoming: File[]) {
  if (!incoming.length) return;

  const accepted = incoming.filter(isLikelyCompressible);
  const rejected = incoming.length - accepted.length;
  if (rejected > 0) {
    showToast(
      rejected === incoming.length
        ? "Nothing there i can squish. Images, audio, video and PDFs."
        : `Skipped ${rejected} file${rejected === 1 ? "" : "s"} i can't squish yet.`,
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
    showToast(`Only took the first ${withinCount.length} — ${ABSOLUTE_MAX_FILES}-file ceiling.`, "warn", 8000);
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
  markCompressDirty("files");
  render();
}

function removeFile(id: number) {
  files = files.filter(e => e.id !== id);
  markCompressDirty("files");
  render();
}

// --- Running a batch ---

const REASON_COPY: Record<string, string> = {
  "already-minimal": "already squished",
  "no-gain": "no gain",
  "unsupported": "can't squish this",
  "failed": "failed",
};

export async function runCompression() {
  if (phase === "running" || !files.length) return;

  // Landing straight on /compress can beat the handler registry loading. With
  // an empty option list every file fails format detection and would be
  // reported "can't squish this", which is a lie about the file.
  if (!allOptionsRef.value.length) {
    showToast("Still warming up the engines — give me a second.", "info", 5000);
    return;
  }

  cancelRequested = false;
  phase = "running";
  progress = { done: 0, total: files.length, current: "" };
  render();

  const options = allOptionsRef.value;
  const outcomes: (CompressOutcome | null)[] = files.map(() => null);
  const recognized: CompressInput[] = [];
  const recognizedAt: number[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i].file;
    const bytes = new Uint8Array(await file.arrayBuffer());
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
    isCancelled: () => cancelRequested,
  });

  batch.forEach((outcome, k) => { outcomes[recognizedAt[k]] = outcome; });
  results = outcomes.filter((o): o is CompressOutcome => o !== null);
  phase = "done";
  render();

  if (results.some(r => r.shrunk)) triggerConfetti();
}

/** Light in-place update so per-file progress doesn't re-render the whole view. */
function paintProgress() {
  if (!rootEl) return;
  const label = rootEl.querySelector<HTMLElement>(".cw-progress-label");
  const bar = rootEl.querySelector<HTMLElement>(".cw-progress-bar-fill");
  const track = rootEl.querySelector<HTMLElement>(".cw-progress-bar");
  if (label) {
    label.textContent = progress.current
      ? `Squishing ${shortenFileName(progress.current, 28)} — ${progress.done} of ${progress.total}`
      : `Squishing ${progress.done} of ${progress.total}`;
  }
  if (bar) bar.style.width = `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%`;
  // Keep the assistive-tech view in step with the visual bar; the label above
  // is a polite live region, so screen readers coalesce rapid file-to-file
  // updates instead of reading every one of a long batch.
  if (track) {
    track.setAttribute("aria-valuemax", String(progress.total));
    track.setAttribute("aria-valuenow", String(progress.done));
  }
}

export async function downloadResults() {
  if (!results.length) return;
  const out = results.map(r => ({ name: r.name, bytes: r.bytes }));
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
      <span class="convert-to-label">Compress by</span>
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

function progressMarkup(): string {
  return `
    <div class="card-base cw-progress-card">
      <p class="cw-progress-label" role="status" aria-live="polite" aria-atomic="true">Squishing ${progress.done} of ${progress.total}</p>
      <div class="cw-progress-bar" role="progressbar" aria-label="Compression progress"
        aria-valuemin="0" aria-valuemax="${progress.total}" aria-valuenow="${progress.done}"><div class="cw-progress-bar-fill" style="width:0%"></div></div>
      <button class="cw-cancel" type="button">Stop</button>
    </div>
  `;
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

  const headline = saved > 0
    ? `Saved ${formatBytes(saved)} <span class="cw-pct">(${pct}% smaller)</span>`
    : noneSupported
      ? `Nothing i can squish here`
      : `Nothing left to shave off`;
  const sub = saved > 0
    ? `${shrunkCount} of ${results.length} file${results.length === 1 ? "" : "s"} got smaller.`
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

  // A text-heavy PDF genuinely cannot shrink: Ghostscript's presets only
  // resample images, and there are none. Without saying so, a correct result
  // reads as a broken feature.
  const stubbornPdf = results.some(r =>
    !r.shrunk && r.reason === "no-gain" && /\.pdf$/i.test(r.name));
  const pdfNote = stubbornPdf
    ? `<p class="cw-results-note">PDFs that are mostly text can't shrink much — their pages are fonts and vector shapes, not images. Scans and image-heavy PDFs squish far more.</p>`
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
    <div class="card-base cw-results-card">
      <div class="cw-results-head" role="status" aria-live="polite" aria-atomic="true">
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

function privacyMarkup(): string {
  return `<p class="cw-privacy">Nothing leaves your device. The squishing happens right here.</p>`;
}

function actionMarkup(): string {
  return `
    <button class="cw-compress btn-primary" type="button">
      Compress ${files.length} file${files.length === 1 ? "" : "s"}
    </button>
  `;
}

function render() {
  if (!rootEl) return;
  if (phase === "running") {
    rootEl.innerHTML = progressMarkup();
  } else if (phase === "done") {
    rootEl.innerHTML = resultsMarkup();
  } else {
    rootEl.innerHTML = files.length
      ? `${uploadFieldMarkup()}${fileListMarkup()}${levelFieldMarkup()}${actionMarkup()}`
      : `${uploadFieldMarkup()}${privacyMarkup()}`;
  }
  wireRendered();
}

function openPicker() {
  if (!fileInput) return;
  fileInput.multiple = true;
  fileInput.click();
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
    levelMenu.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { setOpen(false); levelSelector.focus(); }
    });
    document.addEventListener("click", function onAway(e) {
      if (!levelMenu.isConnected) { document.removeEventListener("click", onAway); return; }
      if (levelMenu.hidden) return;
      if ((e.target as HTMLElement).closest(".cw-level-field")) return;
      setOpen(false);
    });
  }

  rootEl.querySelector<HTMLElement>(".cw-compress")?.addEventListener("click", () => { void runCompression(); });
  rootEl.querySelector<HTMLElement>(".cw-download")?.addEventListener("click", () => { void downloadResults(); });
  rootEl.querySelector<HTMLElement>(".cw-back")?.addEventListener("click", backToFiles);
  rootEl.querySelector<HTMLElement>(".cw-cancel")?.addEventListener("click", () => {
    // Between-files cancellation: the in-flight file finishes, then the batch
    // stops. Hard mid-file cancel would need the shared cancellation singleton.
    cancelRequested = true;
    showToast("Stopping after this file…", "info", 4000);
  });
}

// --- Lifecycle (mirrors PdfWorkspace) ---

export function initCompressWorkspace() {
  if (initialized) {
    resolveRefs();
    render();
    return;
  }
  initialized = true;
  resolveRefs();

  // Async and non-blocking: the empty state paints first when no session exists.
  void tryRestoreCompressSession({
    getFiles: () => files.map(e => e.file),
    getLevel: () => compressLevel.value,
    applyRestored: (restored, restoredLevel) => {
      files = restored.map(file => ({ id: nextId++, file }));
      if (restoredLevel === "high" || restoredLevel === "medium" || restoredLevel === "low") {
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

  render();
}

function resolveRefs() {
  rootEl = document.getElementById("compress-content");
  fileInput = document.getElementById("compress-file-input") as HTMLInputElement | null;
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
  cancelRequested = false;
  void clearCompressSession();
  if (rootEl) render();
}

/** Share-target / launch-queue entry point. */
export function ingestExternalFiles(incoming: File[]) {
  if (!initialized) initCompressWorkspace();
  handleFiles(incoming);
}
