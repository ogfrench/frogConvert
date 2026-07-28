import normalizeMimeType from "../core/utils/normalizeMimeType.ts";
import { downloadFile, downloadAsZip, timestampForFilename } from "./download.ts";
import { isSafari } from "../tools/pdfThumbnails.ts";
import type { FileFormat, FormatHandler, FileData, ConvertPathNode, ProgressEvent, QualityPreset, Notice } from "../core/FormatHandler/FormatHandler.ts";
import { withQualityArg } from "../core/FormatHandler/FormatHandler.ts";
import { DEFAULT_PRESET } from "../core/FormatHandler/qualityPresets.ts";
import { triggerConfetti } from "../effects/Confetti/Confetti.ts";
import {
    ui,
    currentFiles,
    selectedFromIndex,
    selectedToIndex,
    allOptionsRef,
    CATEGORY_LABELS,
} from "../components/store/store.ts";
import { escapeHTML } from "../components/utils/index.ts";
import {
    hidePopup,
    showAlertPopup,
    createPopupButton,
    replacePopup,
} from "../components/Popup/Popup.ts";
import {
    isCancelled,
    resetCancellation,
    showConversionInProgress,
    setWorkerCancelCallback,
    setForceCleanupCallback,
    setCanHardCancel,
    setCurrentFileProgress,
    setActiveConversionMode,
    getActiveConversionMode,
    completeCancellation,
    showPartialDownloadPopup,
    showEnginesLoadingPopup,
    ensureCancelButton,
    removeCancelButton,
    modeCopy,
    updateCancelProgress,
} from "./cancellation.ts";
import { createDancingFrog } from "../components/Frogsworth/DancingFrog.ts";
import { clearConvertSession } from "../components/persistence/convertPersist.ts";
import {
    shortenFileName,
    ensureMinDuration,
    toUserErrorInfo,
    SUPPORT_CONTACT_TEXT,
    GENERIC_CONVERSION_ERROR_TEXT,
    CONVERSION_NOT_AVAILABLE_TEXT,
    formatBytes,
    type UserErrorInfo,
} from "../components/utils/index.ts";
import { probeInputQuality } from "../core/compression/inputQuality.ts";
import { tierDown } from "../core/compression/tierDown.ts";
import { resolveSameFormatHandler, handlerSupportsFormat } from "../core/compression/resolveCompressor.ts";

// --- Helpers ---

const waitForPaint = () => new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
);

let isConverting = false;
export const getIsConverting = () => isConverting;

let _convertingTitle = "Converting...";

/**
 * True when every hop in the path runs in a worker. If any hop has
 * requiresMainThread=true (e.g. pdftoimg) it can't be interrupted inside
 * doConvert, so mid-file cancel has to wait for the current file to finish.
 */
function pathSupportsHardCancel(path: ConvertPathNode[]): boolean {
    return path.every(node => !node.handler?.requiresMainThread);
}

function formatConversionPath(path: ConvertPathNode[]): string {
    return path.map(n => n.format.format).join(" → ");
}

// Tracks the last runtime error from a handler (distinct from "no path exists")
let _lastConversionError: UserErrorInfo | null = null;

/** Called once after a conversion completes, then cleared. Used to defer work that is unsafe to run mid-conversion. */
let onConversionEnd: (() => void) | null = null;
export function setOnConversionEnd(fn: (() => void) | null) {
    onConversionEnd = fn;
}

// --- Format matching ---

export function findMatchingFormat(
    files: File[],
    allOptions: Array<{ format: FileFormat; handler: FormatHandler }>,
): number {
    // Intentionally format-mode-agnostic: detect the real format regardless of the
    // current display mode. refreshUI() re-runs after each handler phase and handles
    // switching to the matched category tab if the format wasn't yet loaded on upload.
    const mimeType = normalizeMimeType(files[0].type);
    // Only treat a trailing segment as an extension when there's an actual dot
    // in the filename. Otherwise `"photo".split(".").pop()` returns the whole
    // name, which would accidentally match a format whose extension happened
    // to equal the filename.
    const name = files[0].name;
    const dotIdx = name.lastIndexOf(".");
    const fileExtension = dotIdx > 0 ? name.slice(dotIdx + 1).toLowerCase() : undefined;
    // Best match: MIME + extension
    let mimeMatch = -1;
    for (let i = 0; i < allOptions.length; i++) {
        const { format } = allOptions[i];
        if (!format.from || format.mime !== mimeType) continue;

        if (fileExtension && format.extension === fileExtension) return i; // Exact MIME+ext match
        if (mimeMatch === -1) mimeMatch = i; // First MIME-only match as fallback
    }
    if (mimeMatch !== -1) return mimeMatch;

    // Fallback: extension-only match
    if (fileExtension) {
        for (let i = 0; i < allOptions.length; i++) {
            const { format } = allOptions[i];
            if (format.from && format.extension.toLowerCase() === fileExtension) {
                return i;
            }
        }
    }

    return -1;
}

// --- Same-format compression ---
// The dispatch layer (resolveSameFormatHandler + helpers + whitelists) now
// lives in src/core/compression/resolveCompressor.ts so any surface can route
// to the compressor without importing this UI-heavy module.

// --- Download & converted-file tracking ---

let lastConvertedFiles: { name: string; bytes: Uint8Array }[] = [];

export function setLastConvertedFiles(files: { name: string; bytes: Uint8Array }[]) {
    lastConvertedFiles = files;
}

export async function downloadAllConvertedFiles() {
    if (lastConvertedFiles.length > 1) {
        await downloadAsZip(lastConvertedFiles, `frogConvert-${timestampForFilename()}.zip`);
    } else {
        for (const file of lastConvertedFiles) {
            downloadFile(file.bytes, file.name);
        }
    }
}

// --- Worker Manager ---
let conversionWorker: Worker | null = null;
let workerMsgId = 0;
const WORKER_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
let workerErrorCallback: ((e: ErrorEvent) => void) | null = null;

function getConversionWorker(): Worker {
    if (!conversionWorker) {
        conversionWorker = new Worker(new URL("../workers/conversion.worker.ts", import.meta.url), { type: "module" });
        conversionWorker.onerror = (err) => {
            // Worker crashed - reject the in-flight promise with a real error, then discard the dead worker
            const cb = workerErrorCallback;
            workerErrorCallback = null;
            setWorkerCancelCallback(null);
            conversionWorker = null;
            cb?.(err);
        };
    }
    return conversionWorker;
}

// bfcache restore: drop stale worker ref so getConversionWorker() re-spawns.
if (typeof window !== "undefined") {
    window.addEventListener("pageshow", (ev) => {
        if ((ev as PageTransitionEvent).persisted) {
            if (conversionWorker) {
                try { conversionWorker.terminate(); } catch { /* already gone */ }
                conversionWorker = null;
            }
        }
    });
}

async function runInWorker(handlerName: string, inputFiles: FileData[], inputFormat: FileFormat, outputFormat: FileFormat, args?: string[], onProgress?: (p: ProgressEvent) => void): Promise<FileData[]> {
    const worker = getConversionWorker();
    const id = ++workerMsgId;
    return new Promise((resolve, reject) => {
        if (isCancelled) { reject(new Error("Cancelled")); return; }

        const cleanup = () => {
            clearTimeout(timeoutId);
            worker.removeEventListener("message", onMessage);
            setWorkerCancelCallback(null);
            workerErrorCallback = null;
        };

        const onMessage = (ev: MessageEvent) => {
            const msg = ev.data;
            if (msg.id !== id) return;
            if (msg.type === "progress") {
                onProgress?.({ ratio: msg.ratio, detail: msg.detail });
                return;
            }
            cleanup();
            if (msg.type === "success") {
                resolve(msg.outputFiles);
            } else {
                reject(msg.error);
            }
        };

        const timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error(`Conversion timed out after ${WORKER_TIMEOUT_MS / 60000} minutes.`));
        }, WORKER_TIMEOUT_MS);

        worker.addEventListener("message", onMessage);
        setWorkerCancelCallback(() => {
            cleanup();
            worker.terminate();
            conversionWorker = null;
            reject(new Error("Cancelled"));
        });
        // Hard-cancel fallback if the normal cancel path doesn't bring us down.
        setForceCleanupCallback(() => {
            cleanup();
            try { worker.terminate(); } catch { /* already terminated */ }
            conversionWorker = null;
            reject(new Error("Cancelled (forced)"));
        });
        workerErrorCallback = (err: ErrorEvent) => {
            cleanup();
            reject(new Error(`Conversion worker crashed: ${err.message}`));
        };
        // Copy bytes before transferring - originals must remain usable if this path fails and another is retried
        const inputCopies = inputFiles.map(f => ({ ...f, bytes: f.bytes.slice() }));
        const transferables = inputCopies.map(f => f.bytes.buffer).filter(b => b.byteLength > 0);
        worker.postMessage({ id, handlerName, inputFiles: inputCopies, inputFormat, outputFormat, args }, transferables);
    });
}

// --- Conversion logic helpers ---

async function preInitPath(path: ConvertPathNode[], onProgress?: (outputFormat: FileFormat) => void) {
    for (let i = 0; i < path.length - 1; i++) {
        if (isCancelled) return;
        const handler = path[i + 1].handler;
        if (!handler.ready) {
            const downloadStart = performance.now();
            onProgress?.(path[i + 1].format);
            try {
                await handler.init();
                if (handler.supportedFormats) {
                    window.supportedFormatCache.set(handler.name, handler.supportedFormats);
                }
                await ensureMinDuration(downloadStart, 1200);
            } catch (e) {
                // Swallow - attemptConvertPath retries init and handles failures
            }
        }
    }
}

/**
 * Warming-up phase: finds the best conversion path and pre-initialises all handlers.
 * Returns the path, or null if no conversion route exists.
 */
async function findConversionPath(
    from: ConvertPathNode,
    to: ConvertPathNode,
    preserveDeadEnds = false,
): Promise<ConvertPathNode[] | null> {
    if (!preserveDeadEnds) window.traversionGraph.clearDeadEndPaths();

    const warmingMsg = `Warming up the engines...<br><span class="conversion-path">finding the best ${modeCopy().routeLabel}</span>`;
    const showWarming = () => showConversionInProgress(warmingMsg, _convertingTitle, "idle");
    showWarming();

    const searchListener = (state: string, _path: ConvertPathNode[]) => {
        if (state === "searching") showWarming();
    };

    window.traversionGraph.addPathEventListener(searchListener);

    try {
        const searchStartTime = performance.now();
        await waitForPaint();

        for await (const path of window.traversionGraph.searchPath(from, to, true)) {
            if (isCancelled) return null;
            if (path.at(-1)?.handler === to.handler) {
                path[path.length - 1] = to;
            }

            await ensureMinDuration(searchStartTime, 1200);
            await preInitPath(path, (outputFormat) => {
                const cat = Array.isArray(outputFormat.category) ? outputFormat.category[0] : outputFormat.category;
                const label = (cat && CATEGORY_LABELS[cat]) ? CATEGORY_LABELS[cat].toLowerCase() : "file";
                showConversionInProgress(
                    `Downloading the ${label} ${modeCopy().toolLabel}...<br><span class="conversion-path">this happens once and may take a moment</span>`,
                    _convertingTitle,
                    "idle",
                );
            });
            if (isCancelled) return null;

            return path;
        }
        return null;
    } finally {
        window.traversionGraph.removePathEventListener(searchListener);
    }
}

async function attemptConvertPath(files: FileData[], path: ConvertPathNode[], onProgress?: (p: ProgressEvent) => void) {
    _lastConversionError = null;
    ensureCancelButton();

    for (let i = 0; i < path.length - 1; i++) {
        if (isCancelled) return null;
        const handler = path[i + 1].handler;
        try {
            let supportedFormats = window.supportedFormatCache.get(handler.name);
            if (!handler.ready) {
                await handler.init();
                if (!handler.ready) throw `Handler "${handler.name}" not ready after init.`;
                if (handler.supportedFormats) {
                    window.supportedFormatCache.set(handler.name, handler.supportedFormats);
                    supportedFormats = handler.supportedFormats;
                }
            }
            if (!supportedFormats) throw `Handler "${handler.name}" doesn't support any formats.`;
            const inputFormat = supportedFormats.find(c =>
                c.from
                && c.mime === path[i].format.mime
                && c.format === path[i].format.format,
            );
            if (!inputFormat) throw `Handler "${handler.name}" doesn't support input format "${path[i].format.format}" (${path[i].format.mime}).`;

            // Only forward progress on the last hop (the one that actually produces the
            // user-visible output). Intermediate hops would double-fill the bar.
            const isLastHop = i === path.length - 2;
            const hopProgress = isLastHop ? onProgress : undefined;

            let hopArgs: string[] | undefined;
            if (isLastHop) {
                const target = path[i + 1].format;
                const quality: QualityPreset = target.lossless ? "lossless" : DEFAULT_PRESET;
                hopArgs = ["--quality", quality];
            }

            let outputFiles: FileData[];
            if (handler.requiresMainThread) {
                const timeoutPromise = new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error(`Conversion timed out after ${WORKER_TIMEOUT_MS / 60000} minutes.`)), WORKER_TIMEOUT_MS)
                );
                outputFiles = await Promise.race([
                    handler.doConvert(files, inputFormat, path[i + 1].format, hopArgs, hopProgress),
                    timeoutPromise,
                ]);
            } else {
                outputFiles = await runInWorker(handler.name, files, inputFormat, path[i + 1].format, hopArgs, hopProgress);
            }

            await waitForPaint();
            files = outputFiles;
            if (files.some(c => !c.bytes.length)) throw "Output is empty.";
        } catch (e) {
            if (isCancelled) return null;
            console.error(handler.name, `${path[i].format.format} \u2192 ${path[i + 1].format.format}`, e);

            _lastConversionError = toUserErrorInfo(e);
            const deadEndPath = path.slice(0, i + 2);
            window.traversionGraph.addDeadEndPath(deadEndPath);

            return null;
        }
    }

    if (isCancelled) return null;
    return { files, path };
}

function showConversionNotFoundPopup(fromFormat: string, toFormat: string) {
    const contact = `<span class="muted-text error-detail">${escapeHTML(SUPPORT_CONTACT_TEXT)}</span>`;
    showAlertPopup(
        "Conversion not available yet",
        `<b>${fromFormat}</b> to <b>${toFormat}</b> isn't available yet.${contact}`,
    );
}

const REASSURANCE_LINE = "feel free to switch tabs";

function mmss(totalSec: number): string {
    const m = Math.floor(totalSec / 60);
    const s = Math.floor(totalSec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Owns the conversion modal for the duration of one file's work. Three slots:
 * main line (stable), muted format/path subtitle, muted live-status line (shows
 * reassurance text, or latest handler detail when one was reported, with a
 * ` · MM:SS` elapsed suffix once the timer has been running ≥10s).
 */
type StatusHandle = {
    cancel: () => void;
    update: (detail: string) => void;
};
function startConversionStatus({ main, subtitle }: { main: string; subtitle: string }): StatusHandle {
    const startedAt = Date.now();
    let tickTimer: ReturnType<typeof setInterval> | null = null;
    let latestDetail: string | undefined;
    let lastHTML: string | null = null;
    let showElapsed = false;

    const render = () => {
        const leading = latestDetail ? escapeHTML(latestDetail) : REASSURANCE_LINE;
        const suffix = showElapsed ? ` · ${mmss((Date.now() - startedAt) / 1000)}` : "";
        const html = [
            main,
            `<span class="muted-text">${escapeHTML(subtitle)}</span>`,
            `<span class="muted-text">${leading}${suffix}</span>`,
        ].join("<br>");
        if (html === lastHTML) return;
        lastHTML = html;
        showConversionInProgress(html, _convertingTitle);
    };

    render(); // initial paint, callers no longer paint the modal themselves

    const slowKick = setTimeout(() => {
        if (isCancelled) return;
        showElapsed = true;
        render();
        tickTimer = setInterval(() => {
            if (isCancelled) { clearInterval(tickTimer!); tickTimer = null; return; }
            render();
        }, 1000);
    }, 10000);

    return {
        cancel: () => {
            clearTimeout(slowKick);
            if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
        },
        update: (detail) => {
            latestDetail = detail;
            updateCancelProgress(detail);
            render();
        },
    };
}

function showConversionFailedPopup(fromFormat: string, toFormat: string, error: UserErrorInfo) {
    // Cancellation routes through showPartialDownloadPopup; if one ever leaks
    // here, don't render it under a failure title.
    if (error.kind === "cancelled") return;

    // Suppress the muted detail line when error.message is one of the catch-all
    // strings already conveyed by the kind-specific body. Specific messages
    // (password-protected, worker crashed, etc.) still surface.
    const isInformativeDetail =
        error.message.length > 0
        && error.message !== GENERIC_CONVERSION_ERROR_TEXT
        && error.message !== CONVERSION_NOT_AVAILABLE_TEXT;
    const detail = isInformativeDetail ? `<span class="muted-text error-detail">${escapeHTML(error.message)}</span>` : "";
    const contact = `<span class="muted-text error-detail">${escapeHTML(SUPPORT_CONTACT_TEXT)}</span>`;
    const fromTo = `<b>${fromFormat}</b> to <b>${toFormat}</b>`;

    if (error.kind === "not_available") {
        showAlertPopup(
            "Conversion not available yet",
            `${fromTo} isn't available yet.${detail}${contact}`,
        );
        return;
    }
    if (error.kind === "unknown") {
        // Default for unrecognised errors: a capability gap, not a file issue.
        // Don't blame the file when we have no positive evidence the input is
        // the cause; surface the maintainer email so the user can flag it.
        showAlertPopup(
            "Conversion not available yet",
            `${fromTo} didn't complete this time. Try a different target format or another file.${detail}${contact}`,
        );
        return;
    }

    const copy = modeCopy();
    if (error.kind === "input_issue") {
        showAlertPopup(
            copy.failedTitle,
            `${fromTo} didn't go through. The file may be password-protected, corrupted, or in a variant the ${copy.toolLabel} can't read.${detail}${contact}`,
        );
        return;
    }
    // runtime_failure
    showAlertPopup(
        copy.failedTitle,
        `${fromTo} was interrupted. Try again, or use a smaller file.${detail}${contact}`,
    );
}

// --- Main convert action ---

export function initConvertButton() {
    ui.convertButton.onclick = async () => {
        // Reentrancy guard: flag is set synchronously before the first await.
        if (isConverting) return;
        isConverting = true;

        const allOutputFiles: FileData[] = [];

        try {
            const inputFiles = currentFiles.value;
            const fileCount = inputFiles.length;

            if (fileCount === 0) {
                showAlertPopup("No files yet", "Drop files here or click the drop zone to pick some.");
                return;
            }

            if (selectedFromIndex.value === null) {
                showAlertPopup("Format not recognised", `Couldn't figure out ${fileCount > 1 ? "these files'" : "this file's"} format. Try a different file?`);
                return;
            }
            if (selectedToIndex.value === null) {
                showAlertPopup("Choose a format", "Select a target format from the dropdown before converting.");
                return;
            }

            if (window.traversionGraph.nodeCount === 0) {
                showEnginesLoadingPopup();
                return;
            }

            const conversionStartTime = performance.now();
            resetCancellation();

            const inputOption = allOptionsRef.value[selectedFromIndex.value];
            const outputOption = allOptionsRef.value[selectedToIndex.value];

            const inputFormat = inputOption.format;
            const outputFormat = outputOption.format;

            const isSameFormatPick = inputFormat.mime === outputFormat.mime
                && inputFormat.format === outputFormat.format;

            const sameFormatDispatch = isSameFormatPick
                ? resolveSameFormatHandler(inputFormat)
                : null;

            const isPureCompression = Boolean(sameFormatDispatch);
            const verbLabel = isPureCompression ? "Compressing" : "Converting";
            const verbSubText = isPureCompression ? "compress" : "convert";

            _convertingTitle = `${verbLabel} your ${fileCount > 1 ? "files" : "file"}`;

            setActiveConversionMode(isPureCompression ? "compress" : "convert");

            await waitForPaint();

            const startupStartTime = performance.now();
            showConversionInProgress(`Reading your ${fileCount > 1 ? "files" : "file"}...<br><span class="conversion-path">getting ready to ${verbSubText}</span>`, _convertingTitle, "idle");
            await waitForPaint();

            const inputFileData: FileData[] = [];
            // Files picked with input format === output format. Compressed inline
            // by the same-format dispatcher when a compressor is available,
            // otherwise pushed through unchanged (today's "No conversion needed"
            // behaviour).
            const sameFormatRaw: { name: string; bytes: Uint8Array }[] = [];

            for (const inputFile of inputFiles) {
                if (isCancelled) return;
                const inputBuffer = await inputFile.arrayBuffer();
                if (isCancelled) return;
                const inputBytes = new Uint8Array(inputBuffer);
                if (isSameFormatPick) {
                    sameFormatRaw.push({ name: inputFile.name, bytes: inputBytes });
                } else {
                    inputFileData.push({ name: inputFile.name, bytes: inputBytes });
                }
            }

            // Enforce minimum startup/warming-up phase duration (includes file reading time)
            await ensureMinDuration(startupStartTime, 1200);

            // slowHandle.update fans out to both the in-progress notice and
            // (when cancel is active) the cancel popup sub-line.
            const makeProgressSink = (status: StatusHandle) => (p: ProgressEvent) => {
                if (typeof p.detail === "string") {
                    status.update(p.detail);
                }
            };

            // Runs before path-finding because the graph has no self-loops.
            // Each file ends up in allOutputFiles with either shrunk bytes
            // (+ originalBytes) or the original bytes when the 98% size-guard
            // fires or the handler throws.

            if (sameFormatDispatch) {
                ensureCancelButton();
                const { handler, args } = sameFormatDispatch;

                let initOk = handler.ready;
                if (!initOk) {
                    try {
                        await handler.init();
                        initOk = handler.ready;
                        if (initOk && handler.supportedFormats) {
                            window.supportedFormatCache.set(handler.name, handler.supportedFormats);
                        }
                    } catch (e) {
                        console.error(handler.name, "same-format init failed", e);
                    }
                }

                const handlerInputFmt = initOk ? handlerSupportsFormat(handler, inputFormat) : null;
                const handlerOutputFmt = initOk ? handlerSupportsFormat(handler, outputFormat) : null;

                if (initOk && handlerInputFmt && handlerOutputFmt) {
                    // Same-format loop never runs findConversionPath, so the
                    // default `canHardCancel = true` would leak through and
                    // show "Stopping now..." even for main-thread handlers.
                    setCanHardCancel(!handler.requiresMainThread);
                    const totalSame = sameFormatRaw.length;
                    for (let i = 0; i < totalSame; i++) {
                        if (isCancelled) break;
                        const file = sameFormatRaw[i];
                        setCurrentFileProgress(i + 1, fileCount);
                        const status = startConversionStatus({
                            main: totalSame > 1
                                ? `Compressing file ${i + 1} of ${totalSame}...`
                                : `Compressing your file...`,
                            subtitle: `${inputFormat.format.toLowerCase()} compression`,
                        });

                        // Lossless inputs stay on their preset; re-encoding would lose information.
                        let perFileArgs = args;
                        let alreadyMinimal = false;
                        if (!inputFormat.lossless) {
                            const probe = await probeInputQuality(file.bytes, inputFormat.mime ?? "");
                            const next = tierDown(probe.inputTier);
                            if (next.kind === "skip") {
                                alreadyMinimal = true;
                            } else {
                                perFileArgs = withQualityArg(args, next.tier);
                            }
                        }

                        if (alreadyMinimal) {
                            status.cancel();
                            allOutputFiles.push({
                                name: file.name,
                                bytes: file.bytes,
                                notices: [{
                                    title: "Already nicely squished 🐸",
                                    body: `${file.name} is already at minimum useful quality. Kept original to avoid further loss.`,
                                }],
                            });
                            continue;
                        }

                        const originalSize = file.bytes.byteLength;
                        let compressed: FileData | null = null;
                        try {
                            const result = handler.requiresMainThread
                                ? await handler.doConvert([file], handlerInputFmt, handlerOutputFmt, perFileArgs, makeProgressSink(status))
                                : await runInWorker(handler.name, [file], handlerInputFmt, handlerOutputFmt, perFileArgs, makeProgressSink(status));
                            if (result && result.length && result[0].bytes.byteLength > 0) {
                                compressed = result[0];
                            }
                        } catch (e) {
                            // Cancellation rejects the worker promise as an error; don't log it
                            // as a real failure.
                            if (!isCancelled) console.error(handler.name, "same-format compression threw", e);
                        }
                        status.cancel();

                        // Cancelled mid-file with no output: drop it. Don't fall through to
                        // pushing the original bytes as if the file had been processed,
                        // that would feed a lie into the partial-download popup.
                        if (compressed === null && isCancelled) break;

                        if (compressed && compressed.bytes.byteLength < originalSize * 0.98) {
                            allOutputFiles.push({
                                name: file.name,
                                bytes: compressed.bytes,
                                warnings: compressed.warnings,
                                notices: compressed.notices,
                                originalBytes: originalSize,
                            });
                        } else {
                            allOutputFiles.push({ name: file.name, bytes: file.bytes });
                        }
                    }
                } else {
                    for (const f of sameFormatRaw) allOutputFiles.push(f);
                }
            } else {
                for (const f of sameFormatRaw) allOutputFiles.push(f);
            }

            if (isCancelled) return;

            // Pure same-format batch: skip path-finding. Fall through to the
            // success popup when at least one file actually shrunk; otherwise
            // show a friendly terminal popup and bail.
            if (inputFileData.length === 0) {
                const anyShrunk = allOutputFiles.some(f => f.originalBytes != null);
                if (!(sameFormatDispatch && anyShrunk)) {
                    await ensureMinDuration(conversionStartTime);
                    const title = sameFormatDispatch ? "Already nicely squished 🐸" : "No conversion needed";
                    const fmt = outputFormat.format.toUpperCase();
                    const singleBody = sameFormatDispatch
                        ? `Couldn't shave any more bytes off <b>${escapeHTML(shortenFileName(inputFiles[0].name, 32))}</b> without losing quality. Downloading the original.`
                        : `<b>${escapeHTML(shortenFileName(inputFiles[0].name, 32))}</b> is already a <b>${escapeHTML(fmt)}</b> file, so there's nothing to convert. Downloading the original for you.`;
                    const batchBody = sameFormatDispatch
                        ? `Couldn't shave any more bytes off these <b>${fileCount} files</b> without losing quality. Downloading the originals.`
                        : `These <b>${fileCount} files</b> are already in <b>${escapeHTML(fmt)}</b> format, so there's nothing to convert. Downloading the originals for you.`;
                    if (fileCount === 1) {
                        downloadFile(allOutputFiles[0].bytes, allOutputFiles[0].name);
                        showAlertPopup(title, singleBody);
                    } else {
                        showAlertPopup(title, batchBody);
                        await downloadAsZip(allOutputFiles, `original-files-${timestampForFilename()}.zip`);
                    }
                    return;
                }
            }

            await waitForPaint();

            ensureCancelButton();

            const isSafariBrowser = isSafari();
            const pathUsesPdfHandler = (path: ConvertPathNode[]) =>
                path.some(n => n.handler?.name === "pdftoimg" || n.handler?.name === "pdftotxt");
            const showSafariPdfPopup = () => showAlertPopup(
                "PDF conversion on Safari",
                "PDF conversion has limited support on Safari due to browser restrictions. For best results, use Chrome or Firefox.",
            );

            // Path-finding and the conversion loop only run when there are
            // cross-format files left. A pure same-format batch has already
            // been handled above.
            const conversionLoopStartTime = performance.now();
            if (inputFileData.length > 0) {
                let conversionPath = await findConversionPath(inputOption, outputOption);
                if (!conversionPath) {
                    if (isCancelled) return;
                    showConversionNotFoundPopup(inputFormat.format.toUpperCase(), outputFormat.format.toUpperCase());
                    return;
                }
                if (isSafariBrowser && pathUsesPdfHandler(conversionPath)) {
                    showSafariPdfPopup();
                    return;
                }
                setCanHardCancel(pathSupportsHardCancel(conversionPath));

            for (let i = 0; i < inputFileData.length; i++) {
                if (isCancelled) break;
                const fileNum = i + 1 + (fileCount - inputFileData.length);
                setCurrentFileProgress(fileNum, fileCount);
                const main = `Converting file ${fileNum} of ${fileCount}...`;

                const status = startConversionStatus({ main, subtitle: formatConversionPath(conversionPath) });

                let result = await attemptConvertPath(
                    [inputFileData[i]],
                    conversionPath,
                    makeProgressSink(status),
                );

                status.cancel();

                if (!result) {
                    if (isCancelled) break;
                    const failedError = _lastConversionError;
                    removeCancelButton(); // Restore "no cancel during warm-up" invariant before retry search
                    // Path failed (dead end) - find the next best path and retry once.
                    // Preserve dead ends so the same broken path isn't rediscovered.
                    conversionPath = await findConversionPath(inputOption, outputOption, true);
                    if (!conversionPath) {
                        if (isCancelled) break;
                        removeCancelButton();
                        if (failedError !== null) {
                            showConversionFailedPopup(inputFormat.format.toUpperCase(), outputFormat.format.toUpperCase(), failedError);
                        } else {
                            showConversionNotFoundPopup(inputFormat.format.toUpperCase(), outputFormat.format.toUpperCase());
                        }
                        return;
                    }
                    if (isSafariBrowser && pathUsesPdfHandler(conversionPath)) {
                        showSafariPdfPopup();
                        return;
                    }
                    setCanHardCancel(pathSupportsHardCancel(conversionPath));
                    const retryStatus = startConversionStatus({ main, subtitle: formatConversionPath(conversionPath) });

                    result = await attemptConvertPath(
                        [inputFileData[i]],
                        conversionPath,
                        makeProgressSink(retryStatus),
                    );

                    retryStatus.cancel();

                    if (!result) {
                        if (isCancelled) break;
                        removeCancelButton();
                        const retryError = _lastConversionError ?? failedError;
                        if (retryError !== null) {
                            showConversionFailedPopup(inputFormat.format.toUpperCase(), outputFormat.format.toUpperCase(), retryError);
                        } else {
                            showConversionNotFoundPopup(inputFormat.format.toUpperCase(), outputFormat.format.toUpperCase());
                        }
                        return;
                    }
                }

                allOutputFiles.push(...result.files);
                if (isCancelled) break;
            }
            } // close `if (inputFileData.length > 0)` guard

            // Enforce minimum duration for the conversion loop
            await ensureMinDuration(conversionLoopStartTime, 1200);

            if (isCancelled) return;

            setLastConvertedFiles(allOutputFiles);

            if (allOutputFiles.length > 1) {
                const packingStartTime = performance.now();
                removeCancelButton();
                showConversionInProgress(
                    `Creating a ZIP folder<br><span class="conversion-path">packing your files</span>`,
                    "Packing your files",
                );
                await waitForPaint();

                // Enforce minimum duration for packing phase
                await ensureMinDuration(packingStartTime, 1200);
            }

            await ensureMinDuration(conversionStartTime);

            if (isCancelled) return;

            const isBatch = allOutputFiles.length > 1;
            // Compression summary: built when at least one file was successfully
            // compressed by the same-format dispatcher (`originalBytes` set).
            const compressedFiles = allOutputFiles.filter(f => f.originalBytes != null);
            const didCompress = compressedFiles.length > 0;
            // Title follows user intent (_activeMode), not byte shrinkage. A
            // cross-format convert that happens to shrink shouldn't rename
            // itself "File compressed!" on the success popup.
            const successTitle = isBatch ? modeCopy().successTitleBatch : modeCopy().successTitleSingle;
            let resultText: string;
            if (didCompress) {
                const totals = compressedFiles.reduce(
                    (acc, f) => ({
                        orig: acc.orig + (f.originalBytes ?? 0),
                        comp: acc.comp + f.bytes.byteLength,
                    }),
                    { orig: 0, comp: 0 },
                );
                const saved = totals.orig - totals.comp;
                const pct = totals.orig > 0 ? Math.round((saved / totals.orig) * 100) : 0;
                if (isBatch) {
                    resultText = `<b>${compressedFiles.length} file${compressedFiles.length === 1 ? "" : "s"}</b> compressed, saved <b>${escapeHTML(formatBytes(saved))}</b> (${pct}% smaller) and is downloading now.`;
                } else {
                    const first = compressedFiles[0];
                    resultText = `<b>${escapeHTML(shortenFileName(first.name, 32))}</b> is smaller now: <b>${escapeHTML(formatBytes(first.originalBytes ?? 0))} to ${escapeHTML(formatBytes(first.bytes.byteLength))}</b> (${pct}% smaller) and is downloading now.`;
                }
            } else {
                resultText = isBatch
                    ? `${allOutputFiles.length} files ${modeCopy().verb} to <b>${escapeHTML(outputFormat.format.toUpperCase())}</b> and zipped up for you, downloading now.`
                    : `<b>${escapeHTML(shortenFileName(inputFiles[0].name, 32))}</b> has been ${modeCopy().verb} to <b>${escapeHTML(outputFormat.format.toUpperCase())}</b> and is downloading now.`;
            }

            const h2 = document.createElement("h2");
            h2.textContent = successTitle;
            const frogDiv = createDancingFrog();
            const p = document.createElement("p");
            p.innerHTML = resultText;

            // Structured notices take priority; `warnings` strings already
            // covered by a notice body are skipped. Two passes so the order
            // that files emit notices vs warnings doesn't leak through.
            // Body-only dedup is enough since every body carries the
            // specific numbers that make it effectively unique.
            const noticeMap = new Map<string, { notice: Notice; files: string[] }>();
            for (const f of allOutputFiles) {
                for (const n of (f.notices ?? [])) {
                    const existing = noticeMap.get(n.body);
                    if (existing) existing.files.push(f.name);
                    else noticeMap.set(n.body, { notice: n, files: [f.name] });
                }
            }
            const legacyWarnings = new Map<string, string[]>();
            for (const f of allOutputFiles) {
                for (const w of (f.warnings ?? [])) {
                    if (noticeMap.has(w)) continue;
                    const existing = legacyWarnings.get(w);
                    if (existing) existing.push(f.name);
                    else legacyWarnings.set(w, [f.name]);
                }
            }

            const buildNoticeCard = (title: string | null, body: string, files: string[], action?: Notice["action"]) => {
                const card = document.createElement("div");
                card.className = "convert-notice";
                const bodyWrap = document.createElement("div");
                bodyWrap.className = "convert-notice-body";
                if (title) {
                    const t = document.createElement("span");
                    t.className = "convert-notice-title";
                    t.textContent = title;
                    bodyWrap.appendChild(t);
                }
                const p = document.createElement("p");
                p.className = "convert-notice-text";
                p.textContent = body;
                if (allOutputFiles.length > 1) {
                    const scope = files.length === allOutputFiles.length
                        ? ` (all ${files.length} files)`
                        : files.length > 1
                            ? ` (${files.length} files)`
                            : ` (${shortenFileName(files[0], 32)})`;
                    const span = document.createElement("span");
                    span.className = "muted-text";
                    span.textContent = scope;
                    p.appendChild(span);
                }
                bodyWrap.appendChild(p);
                card.appendChild(bodyWrap);
                if (action) {
                    const a = document.createElement("a");
                    a.className = "convert-notice-link";
                    a.textContent = action.label;
                    a.href = action.href;
                    a.target = "_blank";
                    a.rel = "noopener";
                    card.appendChild(a);
                }
                return card;
            };

            const noticeCards: HTMLElement[] = [];
            for (const { notice, files } of noticeMap.values()) {
                noticeCards.push(buildNoticeCard(notice.title, notice.body, files, notice.action));
            }
            for (const [body, files] of legacyWarnings) {
                noticeCards.push(buildNoticeCard(null, body, files));
            }

            const actions = document.createElement("div");
            actions.className = "popup-actions-footer";
            actions.appendChild(createPopupButton("Download again", "btn-primary", () => downloadAllConvertedFiles()));
            actions.appendChild(createPopupButton("Done", "btn-secondary", () => hidePopup()));
            const popupChildren: HTMLElement[] = [h2, frogDiv, p];
            if (noticeCards.length > 0) popupChildren.push(...noticeCards);
            popupChildren.push(actions);
            replacePopup(popupChildren);
            // Privacy: the conversion succeeded and the user is downloading
            // their output. Drop the persisted session (manifest + raw input
            // bytes in IndexedDB) so reopening the tab doesn't ghost-restore
            // a finished conversion or leave file bytes on disk for a week.
            clearConvertSession();
            // Show confetti faster for immediate celebration. Confetti is
            // popup-anchored, so skip it if the user already dismissed.
            setTimeout(() => {
                if (ui.popupBox.classList.contains("open")) triggerConfetti();
            }, 150);

            // Delay download slightly longer to let the success UI breathe.
            // Fire unconditionally - earlier we gated on popupBox.open which
            // produced silent file loss when fast-clickers closed the popup
            // before 400ms. The blob URL is independent of popup lifetime.
            setTimeout(() => downloadAllConvertedFiles(), 400);
        } catch (e) {
            if (isCancelled) return;
            console.error(e);
            const detail = toUserErrorInfo(e).message || "Something went wrong while converting this file.";
            const detailHTML = `<span class="muted-text error-detail">${escapeHTML(SUPPORT_CONTACT_TEXT)}</span>`;
            showAlertPopup(
                "Something went wrong",
                `${escapeHTML(detail)}${detailHTML}`,
            );
        } finally {
            // Split cleanup and state-reset: anything in the cleanup block can
            // throw (completeCancellation awaits UI animations; user callbacks
            // can throw), but `isConverting = false` MUST run or the whole app
            // freezes in "Converting…" state with no path back.
            try {
                // In compression mode, "successfully compressed" only describes
                // files that actually shrunk (originalBytes set). Pass-through
                // and already-minimal files are in allOutputFiles too but don't
                // count, the user already has those bytes. In convert mode,
                // every entry is a real conversion output so all of them count.
                const isCompressionMode = getActiveConversionMode() === "compress";
                const meaningfulFiles = isCompressionMode
                    ? allOutputFiles.filter(f => f.originalBytes != null)
                    : allOutputFiles;
                const hasMeaningfulFiles = meaningfulFiles.length > 0;
                const shouldHide = !isCancelled || !hasMeaningfulFiles;
                await completeCancellation(shouldHide);
                if (isCancelled && hasMeaningfulFiles) {
                    setLastConvertedFiles(meaningfulFiles);
                    showPartialDownloadPopup(meaningfulFiles.length, () => {
                        downloadAllConvertedFiles();
                    });
                }
            } catch (cleanupErr) {
                console.error("[conversion] cleanup failed:", cleanupErr);
            }
            resetCancellation();
            isConverting = false;
            if (onConversionEnd) {
                const fn = onConversionEnd;
                onConversionEnd = null;
                try { fn(); } catch (e) { console.error("[conversion] onConversionEnd threw:", e); }
            }
        }
    };
}
