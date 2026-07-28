import "./CompressWorkspace.css";
import type { QualityPreset } from "../../core/FormatHandler/FormatHandler.ts";
import { showToast } from "../Toast/Toast.ts";
import { escapeHTML, formatBytes, shortenFileName } from "../utils/index.ts";
import { isTouchUi } from "../../core/utils/touchUi.ts";
import { ABSOLUTE_MAX_FILES, MAX_TOTAL_FILE_SIZE } from "../../constants/ui.ts";

/**
 * Compress workspace — the dedicated "make my files smaller" surface, a peer
 * of the Converter and the PDF Editor.
 *
 * Module-singleton like PdfWorkspace: state lives at module scope so switching
 * app modes preserves the user's batch. `cleanup()` tears down DOM only;
 * `resetAll()` is the destructive cousin.
 */

/**
 * User-facing levels. NOTE the deliberate inversion: the engine's `low`
 * preset means "low quality target", i.e. the *most* aggressive compression
 * (its tier thresholds fire at half the medium distance and it subtracts from
 * the base image quality), while `high` compresses the least. Labelling them
 * Less/Recommended/Extreme in preset order would do the exact opposite of what
 * the user asked for, so the mapping is spelled out here once.
 */
export type CompressLevel = {
  preset: QualityPreset;
  label: string;
  blurb: string;
};

export const COMPRESS_LEVELS: readonly CompressLevel[] = [
  { preset: "high", label: "Less", blurb: "Barely touched. Best quality, modest savings." },
  { preset: "medium", label: "Recommended", blurb: "Balanced. Big savings, quality you won't miss." },
  { preset: "low", label: "Extreme", blurb: "Smallest files. Quality loss you can see." },
  { preset: "lossless", label: "Lossless", blurb: "Not a pixel lost. Savings vary a lot." },
];

export const DEFAULT_LEVEL: QualityPreset = "medium";

type Entry = { id: number; file: File };

let files: Entry[] = [];
let level: QualityPreset = DEFAULT_LEVEL;
let nextId = 1;
let initialized = false;

let rootEl: HTMLElement | null = null;
let fileInput: HTMLInputElement | null = null;

/** Test seam + share-target entry point. */
export function getFiles(): readonly Entry[] { return files; }
export function getLevel(): QualityPreset { return level; }

/**
 * Cheap intake filter. The authoritative "can this actually be compressed?"
 * check needs the loaded handler list and happens at compress time; here we
 * only keep obviously-wrong drops out of the batch.
 * PDF lands in Phase 2 (#14).
 */
export function isLikelyCompressible(file: File): boolean {
  const mime = (file.type || "").toLowerCase();
  return mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/");
}

export function handleFiles(incoming: File[]) {
  if (!incoming.length) return;

  const accepted = incoming.filter(isLikelyCompressible);
  const rejected = incoming.length - accepted.length;
  if (rejected > 0) {
    showToast(
      rejected === incoming.length
        ? "Nothing there i can squish. Images, audio and video for now."
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

  for (const file of withinBudget) files.push({ id: nextId++, file });
  render();
}

function removeFile(id: number) {
  files = files.filter(e => e.id !== id);
  render();
}

// --- Rendering ---

function dropzoneMarkup(): string {
  const hint = isTouchUi() ? "or tap to browse" : "or click to browse";
  return `
    <div class="card-base cw-dropzone-card">
      <div class="cw-dropzone" role="button" tabindex="0" aria-label="Drop files to compress">
        <p class="upload-text">Drop files to squish</p>
        <p class="upload-hint">${hint}</p>
        <p class="cw-dropzone-types">images · audio · video</p>
      </div>
    </div>
    <p class="cw-privacy">Nothing leaves your device. The squishing happens right here.</p>
  `;
}

function levelPickerMarkup(): string {
  const options = COMPRESS_LEVELS.map(l => `
    <button class="cw-level ${l.preset === level ? "active" : ""}" data-level="${l.preset}"
      type="button" aria-pressed="${l.preset === level}">
      <span class="cw-level-label">${escapeHTML(l.label)}</span>
    </button>
  `).join("");
  const active = COMPRESS_LEVELS.find(l => l.preset === level);
  return `
    <div class="cw-levels-wrap">
      <div class="cw-levels" role="group" aria-label="Compression level">${options}</div>
      <p class="cw-level-blurb">${escapeHTML(active?.blurb ?? "")}</p>
    </div>
  `;
}

function fileListMarkup(): string {
  const total = files.reduce((sum, e) => sum + e.file.size, 0);
  const rows = files.map(e => `
    <li class="cw-row" data-id="${e.id}">
      <span class="cw-row-name" title="${escapeHTML(e.file.name)}">${escapeHTML(shortenFileName(e.file.name, 40))}</span>
      <span class="cw-row-size">${formatBytes(e.file.size)}</span>
      <button class="cw-row-remove" type="button" data-remove="${e.id}"
        aria-label="Remove ${escapeHTML(e.file.name)}">&times;</button>
    </li>
  `).join("");
  return `
    <div class="card-base cw-list-card">
      <div class="cw-list-head">
        <span>${files.length} file${files.length === 1 ? "" : "s"}</span>
        <span class="cw-list-total">${formatBytes(total)}</span>
      </div>
      <ul class="cw-list">${rows}</ul>
      <button class="cw-add-more" type="button">Add more files</button>
    </div>
  `;
}

function render() {
  if (!rootEl) return;
  rootEl.innerHTML = files.length
    ? `${levelPickerMarkup()}${fileListMarkup()}`
    : dropzoneMarkup();
  wireRendered();
}

function openPicker() {
  if (!fileInput) return;
  fileInput.multiple = true;
  fileInput.click();
}

function wireRendered() {
  if (!rootEl) return;

  const zone = rootEl.querySelector<HTMLElement>(".cw-dropzone");
  if (zone) {
    zone.addEventListener("click", openPicker);
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

  rootEl.querySelector<HTMLElement>(".cw-add-more")?.addEventListener("click", openPicker);

  for (const btn of rootEl.querySelectorAll<HTMLElement>("[data-remove]")) {
    btn.addEventListener("click", () => removeFile(Number(btn.dataset.remove)));
  }

  for (const btn of rootEl.querySelectorAll<HTMLElement>(".cw-level")) {
    btn.addEventListener("click", () => {
      const next = btn.dataset.level as QualityPreset;
      if (next === level) return;
      level = next;
      render();
    });
  }
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
  level = DEFAULT_LEVEL;
  if (rootEl) render();
}

/** Share-target / launch-queue entry point. */
export function ingestExternalFiles(incoming: File[]) {
  if (!initialized) initCompressWorkspace();
  handleFiles(incoming);
}
