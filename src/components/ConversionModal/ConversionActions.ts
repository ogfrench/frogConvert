import JSZip from "jszip";
import { saveAs } from "file-saver";
import normalizeMimeType from "../../core/utils/normalizeMimeType.ts";
import { isSafari } from "../../tools/pdfThumbnails.ts";
import type { FileFormat, FormatHandler, FileData, ConvertPathNode, ProgressEvent, QualityPreset } from "../../core/FormatHandler/FormatHandler.ts";
import { triggerConfetti } from "../../effects/Confetti/Confetti.ts";
import {
    ui,
    currentFiles,
    selectedFromIndex,
    selectedToIndex,
    allOptionsRef,
    escapeHTML,
    hidePopup,
    showAlertPopup,
    createPopupButton,
    isCancelled,
    isSoftCancelRequested,
    setActiveBatchSize,
    resetCancellation,
    showConversionInProgress,
    setWorkerCancelCallback,
    completeCancellation,
    showPartialDownloadPopup,
    showEnginesLoadingPopup,
    ensureCancelButton,
    removeCancelButton,
    replacePopup,
    CATEGORY_LABELS,
} from "../index.ts";
import { createDancingFrog } from "../Frogsworth/DancingFrog.ts";
import { shortenFileName, ensureMinDuration } from "../utils.ts";

// --- Helpers ---

const waitForPaint = () => new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
);

function getFormattedDate() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

let isConverting = false;
export const getIsConverting = () => isConverting;

let _convertingTitle = "Converting...";

// Tracks the last runtime error from a handler (distinct from "no path exists")
let _lastConversionError: string | null = null;

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
    const fileExtension = files[0].name.split(".").pop()?.toLowerCase();
    // Best match: MIME + extension
    let mimeMatch = -1;
    for (let i = 0; i < allOptions.length; i++) {
        const { format } = allOptions[i];
        if (!format.from || format.mime !== mimeType) continue;

        if (format.extension === fileExtension) return i; // Exact MIME+ext match
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

// --- Download & converted-file tracking ---

let lastConvertedFiles: { name: string; bytes: Uint8Array }[] = [];

export function setLastConvertedFiles(files: { name: string; bytes: Uint8Array }[]) {
    lastConvertedFiles = files;
}

export function downloadFile(bytes: Uint8Array, name: string) {
    const blob = new Blob([bytes as BlobPart], { type: "application/octet-stream" });
    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export async function downloadAsZip(files: { name: string; bytes: Uint8Array }[], zipName: string) {
    const zip = new JSZip();
    for (const file of files) {
        zip.file(file.name, file.bytes);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, zipName);
}

export async function downloadAllConvertedFiles() {
    if (lastConvertedFiles.length > 1) {
        await downloadAsZip(lastConvertedFiles, `frogConvert-${getFormattedDate()}.zip`);
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
        conversionWorker = new Worker(new URL("../../workers/conversion.worker.ts", import.meta.url), { type: "module" });
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
                if (onProgress && typeof msg.ratio === "number") onProgress({ ratio: msg.ratio });
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
                await ensureMinDuration(downloadStart, 500);
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

    const warmingMsg = `Warming up the engines...<br><span class="conversion-path">finding the best conversion route</span>`;
    showConversionInProgress(warmingMsg, _convertingTitle);

    const searchListener = (state: string, _path: ConvertPathNode[]) => {
        if (state === "searching") {
            showConversionInProgress(warmingMsg, _convertingTitle);
        }
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

            await ensureMinDuration(searchStartTime, 1000);
            await preInitPath(path, (outputFormat) => {
                const cat = Array.isArray(outputFormat.category) ? outputFormat.category[0] : outputFormat.category;
                const label = (cat && CATEGORY_LABELS[cat]) ? CATEGORY_LABELS[cat].toLowerCase() : "file";
                showConversionInProgress(
                    `Downloading the ${label} converter...<br><span class="conversion-path">this happens once and may take a moment</span>`,
                    _convertingTitle,
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

async function attemptConvertPath(files: FileData[], path: ConvertPathNode[], batchMsg?: string, onProgress?: (p: ProgressEvent) => void) {
    const pathString = path.map(c => c.format.format).join(" \u2192 ");

    _lastConversionError = null;
    ensureCancelButton();

    // Show status + path immediately - path is already validated by findConversionPath
    const messageHTML = batchMsg
        ? `${batchMsg}<br><span class="muted-text">${pathString}</span>`
        : `<span class="conversion-path">${pathString}</span>`;
    showConversionInProgress(messageHTML, _convertingTitle);

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
                const quality: QualityPreset = target.lossless ? "lossless" : "high";
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

            _lastConversionError = String(e);
            const deadEndPath = path.slice(0, i + 2);
            window.traversionGraph.addDeadEndPath(deadEndPath);

            return null;
        }
    }

    if (isCancelled) return null;
    return { files, path };
}

function showConversionNotFoundPopup(fromFormat: string, toFormat: string) {
    showAlertPopup(
        "You found a missing feature 🔎",
        `<b>${fromFormat}</b> to <b>${toFormat}</b> isn't available right now, but more formats are on the way!`,
    );
}

/**
 * Starts a slow-conversion notice after 10s, alternating with path info every 10s.
 * The returned handle exposes `cancel()` to stop the timer, and `suppress()` which
 * the caller invokes once a real progress bar has appeared — the "may take a while"
 * fallback is only useful when we have no determinate signal.
 */
type SlowTimerHandle = { cancel: () => void; suppress: () => void };
function startSlowConversionTimer(batchMsg: string, pathStr: string): SlowTimerHandle {
    let showingSlowNotice = false;
    let alternateTimer: ReturnType<typeof setInterval> | null = null;
    let suppressed = false;
    const slowTimer = setTimeout(() => {
        if (isCancelled || suppressed) return;
        showingSlowNotice = true;
        showConversionInProgress(
            `${batchMsg}<br><span class="muted-text">Large file - this may take a while...</span>`,
            _convertingTitle,
        );
        alternateTimer = setInterval(() => {
            if (isCancelled || suppressed) { clearInterval(alternateTimer!); alternateTimer = null; return; }
            showingSlowNotice = !showingSlowNotice;
            showConversionInProgress(
                showingSlowNotice
                    ? `${batchMsg}<br><span class="muted-text">Large file - this may take a while...</span>`
                    : `${batchMsg}<br><span class="muted-text">${pathStr}</span>`,
                _convertingTitle,
            );
        }, 10000);
    }, 10000);
    const cancel = () => {
        clearTimeout(slowTimer);
        if (alternateTimer) { clearInterval(alternateTimer); alternateTimer = null; }
    };
    return {
        cancel,
        suppress: () => {
            suppressed = true;
            cancel();
        },
    };
}

function showConversionFailedPopup(fromFormat: string, toFormat: string, error: string) {
    const detail = error.length > 0 ? `<span class="muted-text error-detail">${escapeHTML(error.slice(0, 300))}</span>` : "";
    showAlertPopup(
        "Conversion failed",
        `Something went wrong converting <b>${fromFormat}</b> to <b>${toFormat}</b>. The file may be corrupted, password-protected, or too complex for the converter.${detail}`,
    );
}

// --- Main convert action ---

export function initConvertButton() {
    ui.convertButton.onclick = async () => {
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

            const inputOption = allOptionsRef.value[selectedFromIndex.value];
            const outputOption = allOptionsRef.value[selectedToIndex.value];

            const inputFormat = inputOption.format;
            const outputFormat = outputOption.format;

            const conversionStartTime = performance.now();
            resetCancellation();

            _convertingTitle = `Converting your ${fileCount > 1 ? "files" : "file"}`;

            await waitForPaint();

            const startupStartTime = performance.now();
            showConversionInProgress(`Reading your ${fileCount > 1 ? "files" : "file"}...<br><span class="conversion-path">getting ready to convert</span>`, _convertingTitle);
            await waitForPaint();

            const inputFileData: FileData[] = [];

            for (const inputFile of inputFiles) {
                if (isCancelled) return;
                const inputBuffer = await inputFile.arrayBuffer();
                if (isCancelled) return;
                const inputBytes = new Uint8Array(inputBuffer);
                if (
                    inputFormat.mime === outputFormat.mime
                    && inputFormat.format === outputFormat.format
                ) {
                    allOutputFiles.push({ name: inputFile.name, bytes: inputBytes });
                    continue;
                }
                inputFileData.push({ name: inputFile.name, bytes: inputBytes });
            }

            // Enforce minimum startup/warming-up phase duration (includes file reading time)
            await ensureMinDuration(startupStartTime, 1000);

            if (allOutputFiles.length === fileCount && inputFileData.length === 0) {
                const fmt = outputFormat.format.toUpperCase();
                if (fileCount === 1) {
                    const truncName = shortenFileName(inputFiles[0].name, 32);
                    downloadFile(allOutputFiles[0].bytes, allOutputFiles[0].name);
                    showAlertPopup("No conversion needed", `<b>${escapeHTML(truncName)}</b> is already a <b>${escapeHTML(fmt)}</b> file, so there's nothing to convert. Downloading the original for you.`);
                    return;
                } else {
                    showAlertPopup("No conversion needed", `These <b>${fileCount} files</b> are already in <b>${escapeHTML(fmt)}</b> format, so there's nothing to convert. Downloading the originals for you.`);
                    await downloadAsZip(allOutputFiles, `original-files-${getFormattedDate()}.zip`);
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
                "PDF conversion has limited support on Safari due to browser restrictions. For best results, use Chrome or Firefox. Frogsworth is sorry ₍𝄐~𝄐₎",
            );

            // Find the conversion path during warming-up (cancel is now available).
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

            // Suppress the "may take a while" fallback once a handler reports
            // real progress. Ratio 0 is a reset hint and must NOT suppress.
            const makeProgressSink = (slowHandle: SlowTimerHandle) => (p: ProgressEvent) => {
                if (typeof p.ratio === "number" && p.ratio > 0) slowHandle.suppress();
            };

            // Tell the cancel system whether this is a batch or single-file run,
            // so it knows whether to use two-stage (batch) or one-click (single) cancel.
            setActiveBatchSize(inputFileData.length);

            const conversionLoopStartTime = performance.now();
            for (let i = 0; i < inputFileData.length; i++) {
                if (isCancelled) break;
                // Soft cancel: finish what we have, stop before starting the next file.
                if (isSoftCancelRequested()) break;
                const fileNum = i + 1 + (fileCount - inputFileData.length);
                const batchMsg = `Converting file ${fileNum} of ${fileCount}...`;

                // After 10s, alternate between path info and a "taking a while" notice every 10s.
                // Suppressed automatically once determinate progress arrives.
                const pathStr = conversionPath.map(c => c.format.format).join(" → ");
                const slowHandle = startSlowConversionTimer(batchMsg, pathStr);

                let result = await attemptConvertPath(
                    [inputFileData[i]],
                    conversionPath,
                    batchMsg,
                    makeProgressSink(slowHandle),
                );

                slowHandle.cancel();

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
                    const retryPathStr = conversionPath.map(c => c.format.format).join(" → ");
                    const retrySlowHandle = startSlowConversionTimer(batchMsg, retryPathStr);

                    result = await attemptConvertPath(
                        [inputFileData[i]],
                        conversionPath,
                        batchMsg,
                        makeProgressSink(retrySlowHandle),
                    );

                    retrySlowHandle.cancel();

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

            // Enforce minimum duration for the conversion loop
            await ensureMinDuration(conversionLoopStartTime, 1000);

            if (isCancelled) return;

            // Soft cancel: batch stopped early but finished cleanly. Route to
            // the partial-download popup instead of claiming "all done! 🎉".
            if (isSoftCancelRequested() && allOutputFiles.length < inputFileData.length) {
                setLastConvertedFiles(allOutputFiles);
                removeCancelButton();
                if (allOutputFiles.length > 0) {
                    showPartialDownloadPopup(allOutputFiles.length, () => {
                        downloadAllConvertedFiles();
                    });
                } else {
                    hidePopup();
                }
                return;
            }

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
                await ensureMinDuration(packingStartTime, 1000);
            }

            await ensureMinDuration(conversionStartTime);

            if (isCancelled) return;

            const isBatch = allOutputFiles.length > 1;
            const successTitle = isBatch ? "Files converted! 🎉" : "File converted! 🎉";
            const resultText = isBatch
                ? `${allOutputFiles.length} files converted to <b>${escapeHTML(outputFormat.format.toUpperCase())}</b> and zipped up for you, downloading now.`
                : `<b>${escapeHTML(shortenFileName(inputFiles[0].name, 32))}</b> has been converted to <b>${escapeHTML(outputFormat.format.toUpperCase())}</b> and is downloading now.`;

            const h2 = document.createElement("h2");
            h2.textContent = successTitle;
            const frogDiv = createDancingFrog();
            const p = document.createElement("p");
            p.innerHTML = resultText;

            // Aggregate dedupe warnings emitted by handlers (e.g. FFmpeg
            // recovery padding the output, sample-rate coercion). Surface
            // them so the user knows the result isn't a literal-faithful
            // conversion.
            const allWarnings = Array.from(new Set(
                allOutputFiles.flatMap(f => f.warnings ?? [])
            ));
            const warningNode = allWarnings.length > 0
                ? (() => {
                    const div = document.createElement("div");
                    div.className = "conversion-warnings";
                    div.innerHTML = `<strong>Heads up:</strong><ul>${
                        allWarnings.map(w => `<li>${escapeHTML(w)}</li>`).join("")
                    }</ul>`;
                    return div;
                })()
                : null;

            const actions = document.createElement("div");
            actions.className = "popup-actions-footer";
            actions.appendChild(createPopupButton("Download again", "btn-primary", () => downloadAllConvertedFiles()));
            actions.appendChild(createPopupButton("Done", "btn-secondary", () => hidePopup()));
            const popupChildren: HTMLElement[] = [h2, frogDiv, p];
            if (warningNode) popupChildren.push(warningNode);
            popupChildren.push(actions);
            replacePopup(popupChildren);
            // Show confetti faster for immediate celebration
            setTimeout(() => {
                if (ui.popupBox.classList.contains("open")) triggerConfetti();
            }, 150);

            // Delay download slightly longer to let the success UI breathe
            setTimeout(() => {
                if (ui.popupBox.classList.contains("open")) downloadAllConvertedFiles();
            }, 400);
        } catch (e) {
            if (isCancelled) return;
            console.error(e);
            showAlertPopup("Something went wrong", escapeHTML(String(e)));
        } finally {
            const hasConvertedFiles = allOutputFiles.length > 0;
            const shouldHide = !isCancelled || !hasConvertedFiles;

            // Clean up progress / download-finished UI regardless of outcome —
            // they're only meaningful while a batch is running.
            await completeCancellation(shouldHide);

            if (isCancelled && hasConvertedFiles) {
                setLastConvertedFiles(allOutputFiles);
                showPartialDownloadPopup(allOutputFiles.length, () => {
                    downloadAllConvertedFiles();
                });
            }

            resetCancellation();
            isConverting = false;
            if (onConversionEnd) {
                const fn = onConversionEnd;
                onConversionEnd = null;
                fn();
            }
        }
    };
}
