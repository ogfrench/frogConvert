import JSZip from "jszip";
import { saveAs } from "file-saver";
import normalizeMimeType from "../../core/utils/normalizeMimeType.ts";
import type { FileFormat, FormatHandler, FileData, ConvertPathNode } from "../../core/FormatHandler/FormatHandler.ts";
import { triggerConfetti } from "../../effects/Confetti/Confetti.ts";
import {
    ui,
    currentFiles,
    selectedFromIndex,
    selectedToIndex,
    allOptionsRef,
    escapeHTML,
    showPopup,
    hidePopup,
    showAlertPopup,
    createPopupButton,
    isCancelled,
    resetCancellation,
    showConversionInProgress,
    setWorkerCancelCallback,
    completeCancellation,
    showPartialDownloadPopup,
    ensureCancelButton,
    removeCancelButton,
    replacePopup,
    CATEGORY_LABELS
} from "../index.ts";
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

let _enginesLoadingPollId: ReturnType<typeof setInterval> | null = null;

function _showEnginesLoadingPopup() {
    if (_enginesLoadingPollId !== null) {
        clearInterval(_enginesLoadingPollId);
        _enginesLoadingPollId = null;
    }

    const popupStartTime = performance.now();

    showPopup(
        `<h2>Wow, you're fast! ⚡</h2>` +
        `<div class="loader-spinner"></div>` +
        `<p>Engines are starting up. This only happens on first load, so it'll be instant next time!</p>` +
        `<div class="popup-actions">` +
        `<button class="btn-secondary" id="engines-dismiss-btn">Dismiss</button>` +
        `</div>`,
    );
    ui.popupBox.dataset.enginesLoading = "1";
    requestAnimationFrame(() => {
        document.getElementById("engines-dismiss-btn")?.addEventListener("click", () => {
            delete ui.popupBox.dataset.enginesLoading;
            hidePopup();
        });
    });
    _enginesLoadingPollId = setInterval(async () => {
        if (window.traversionGraph.nodeCount > 0) {
            clearInterval(_enginesLoadingPollId!);
            _enginesLoadingPollId = null;

            // Enforce 1s min duration so it doesn't flicker
            await ensureMinDuration(popupStartTime, 1000);
            _updatePopupToEnginesReady();
        }
    }, 200);
}

function _updatePopupToEnginesReady() {
    // Guard 1: popup was dismissed before engines loaded — don't update a hidden popup
    if (!ui.popupBox.classList.contains("open")) return;
    // Guard 2: another popup replaced our content — check for the unique marker set when this popup opened
    if (!ui.popupBox.dataset.enginesLoading) return;
    delete ui.popupBox.dataset.enginesLoading;
    const spinner = ui.popupBox.querySelector<HTMLElement>(".loader-spinner");
    if (!spinner) return;

    const h2 = ui.popupBox.querySelector("h2");
    const p = ui.popupBox.querySelector("p");
    const actions = ui.popupBox.querySelector(".popup-actions");

    const icon = document.createElement("div");
    icon.className = "engines-ready-icon";
    spinner.replaceWith(icon);

    if (h2) h2.textContent = "Engines ready!";
    if (p) p.textContent = "All conversion engines loaded. Ready to convert!";
    if (actions) {
        actions.innerHTML = "";
        const btn = document.createElement("button");
        btn.className = "btn-primary";
        btn.textContent = "Convert now";
        btn.addEventListener("click", () => {
            hidePopup();
            ui.convertButton.click();
        });
        actions.appendChild(btn);
    }
}

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
            // Worker crashed — reject the in-flight promise with a real error, then discard the dead worker
            const cb = workerErrorCallback;
            workerErrorCallback = null;
            setWorkerCancelCallback(null);
            conversionWorker = null;
            cb?.(err);
        };
    }
    return conversionWorker;
}

async function runInWorker(handlerName: string, inputFiles: FileData[], inputFormat: FileFormat, outputFormat: FileFormat, args?: string[]): Promise<FileData[]> {
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
            if (msg.id === id) {
                cleanup();
                if (msg.type === "success") {
                    resolve(msg.outputFiles);
                } else {
                    reject(msg.error);
                }
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
        // Copy bytes before transferring — originals must remain usable if this path fails and another is retried
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
                // Swallow — attemptConvertPath retries init and handles failures
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

async function attemptConvertPath(files: FileData[], path: ConvertPathNode[], batchMsg?: string) {
    const pathString = path.map(c => c.format.format).join(" \u2192 ");

    ensureCancelButton();

    // Show status + path immediately — path is already validated by findConversionPath
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

            let outputFiles: FileData[];
            if (handler.requiresMainThread) {
                outputFiles = await handler.doConvert(files, inputFormat, path[i + 1].format);
            } else {
                outputFiles = await runInWorker(handler.name, files, inputFormat, path[i + 1].format);
            }

            await waitForPaint();
            files = outputFiles;
            if (files.some(c => !c.bytes.length)) throw "Output is empty.";
        } catch (e) {
            if (isCancelled) return null;
            console.log(path.map(c => c.format.format));
            console.error(handler.name, `${path[i].format.format} \u2192 ${path[i + 1].format.format}`, e);

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

// --- Dancing frog for success popup ---

function createDancingFrog(): HTMLElement {
    const BASE_FRAME = "ദ്ദി₍𝄐⩌𝄐₎";
    const frogFrames = [
        "/₍𝄐⩌𝄐₎/",
        "ヽ₍𝄐⩌𝄐₎ﾉ",
        "ﾉ₍𝄐⩌𝄐₎ヽ",
        "₍𝄐⩌𝄐₎",
        "₍𝄐-𝄐₎",
        "\\₍𝄐⩌𝄐₎/",
        "/₍𝄐~𝄐₎/",
        "₍𝄐~𝄐₎",
    ];
    const frogDiv = document.createElement("div");
    frogDiv.className = "dancing-frog";
    const spanA = document.createElement("span");
    const spanB = document.createElement("span");
    spanA.textContent = BASE_FRAME;
    spanB.textContent = BASE_FRAME;
    spanA.style.opacity = "1";
    spanB.style.opacity = "0";
    frogDiv.appendChild(spanA);
    frogDiv.appendChild(spanB);
    let frameIndex = 0;
    let curSpan = spanA, nxtSpan = spanB;
    let frogInterval: ReturnType<typeof setInterval> | null = null;
    const crossfadeTo = (text: string) => {
        nxtSpan.textContent = text;
        nxtSpan.style.opacity = "1";
        curSpan.style.opacity = "0";
        [curSpan, nxtSpan] = [nxtSpan, curSpan];
    };
    frogDiv.addEventListener("mouseenter", () => {
        if (frogInterval) return;
        frogInterval = setInterval(() => {
            if (!document.contains(frogDiv)) { clearInterval(frogInterval!); frogInterval = null; return; }
            frameIndex = (frameIndex + 1) % frogFrames.length;
            crossfadeTo(frogFrames[frameIndex]);
        }, 700);
    });
    frogDiv.addEventListener("mouseleave", () => {
        if (frogInterval) { clearInterval(frogInterval); frogInterval = null; }
        frameIndex = 0; // reset so next hover always starts from the first frame
        crossfadeTo(BASE_FRAME);
    });
    return frogDiv;
}

// --- Main convert action ---

export function initConvertButton() {
    ui.convertButton.onclick = async () => {
        if (isConverting) return;
        isConverting = true;

        const allOutputFiles: { name: string; bytes: Uint8Array }[] = [];

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
                _showEnginesLoadingPopup();
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

            // Find the conversion path during warming-up (cancel is now available).
            let conversionPath = await findConversionPath(inputOption, outputOption);
            if (!conversionPath) {
                if (isCancelled) return;
                showConversionNotFoundPopup(inputFormat.format.toUpperCase(), outputFormat.format.toUpperCase());
                return;
            }

            const conversionLoopStartTime = performance.now();
            for (let i = 0; i < inputFileData.length; i++) {
                if (isCancelled) break;
                const fileNum = i + 1 + (fileCount - inputFileData.length);
                const batchMsg = `Converting file ${fileNum} of ${fileCount}...`;

                let result = await attemptConvertPath([inputFileData[i]], conversionPath, batchMsg);

                if (!result) {
                    if (isCancelled) break;
                    removeCancelButton(); // Restore "no cancel during warm-up" invariant before retry search
                    // Path failed (dead end) — find the next best path and retry once.
                    // Preserve dead ends so the same broken path isn't rediscovered.
                    conversionPath = await findConversionPath(inputOption, outputOption, true);
                    if (!conversionPath) {
                        if (isCancelled) break;
                        removeCancelButton();
                        showConversionNotFoundPopup(inputFormat.format.toUpperCase(), outputFormat.format.toUpperCase());
                        return;
                    }
                    result = await attemptConvertPath([inputFileData[i]], conversionPath, batchMsg);
                    if (!result) {
                        if (isCancelled) break;
                        removeCancelButton();
                        showConversionNotFoundPopup(inputFormat.format.toUpperCase(), outputFormat.format.toUpperCase());
                        return;
                    }
                }

                allOutputFiles.push(...result.files);
                if (isCancelled) break;
            }

            // Enforce minimum duration for the conversion loop
            await ensureMinDuration(conversionLoopStartTime, 1000);

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
            const actions = document.createElement("div");
            actions.className = "popup-actions-footer";
            actions.appendChild(createPopupButton("Download again", "btn-primary", () => downloadAllConvertedFiles()));
            actions.appendChild(createPopupButton("Done", "btn-secondary", () => hidePopup()));
            replacePopup([h2, frogDiv, p, actions]);
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
