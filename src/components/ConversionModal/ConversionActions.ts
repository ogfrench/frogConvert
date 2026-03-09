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
    isCancelled,
    resetCancellation,
    showConversionInProgress,
    setWorkerCancelCallback,
    completeCancellation,
    showPartialDownloadPopup
} from "../index.ts";
import { shortenFileName } from "../utils.ts";

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

let _enginesLoadingPollId: ReturnType<typeof setInterval> | null = null;

function _showEnginesLoadingPopup() {
    if (_enginesLoadingPollId !== null) {
        clearInterval(_enginesLoadingPollId);
        _enginesLoadingPollId = null;
    }
    showPopup(
        `<h2>Wow, you're fast! ⚡</h2>` +
        `<div class="loader-spinner"></div>` +
        `<p>Engines are starting up. This only happens on first load, so it'll be instant next time!</p>` +
        `<div class="popup-actions">` +
        `<button class="popup-secondary" onclick="window.hidePopup()">Dismiss</button>` +
        `</div>`,
    );
    _enginesLoadingPollId = setInterval(() => {
        if (window.traversionGraph.nodeCount > 0) {
            clearInterval(_enginesLoadingPollId!);
            _enginesLoadingPollId = null;
            _updatePopupToEnginesReady();
        }
    }, 200);
}

function _updatePopupToEnginesReady() {
    // Guard 1: popup was dismissed before engines loaded — don't update a hidden popup
    if (!ui.popupBox.classList.contains("popup-visible")) return;
    // Guard 2: another popup replaced our content (no spinner means different popup is showing)
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
        btn.className = "popup-primary";
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
            if (format.from && format.extension.toLowerCase() === fileExtension) return i;
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

window.downloadAgain = function () {
    downloadAllConvertedFiles();
};

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
            reject(new Error("Cancelled"));
        });
        workerErrorCallback = (err: ErrorEvent) => {
            cleanup();
            reject(new Error(`Conversion worker crashed: ${err.message}`));
        };
        const transferables = inputFiles.map(f => f.bytes.buffer).filter(b => b.byteLength > 0);
        worker.postMessage({ id, handlerName, inputFiles, inputFormat, outputFormat, args }, transferables);
    });
}

// --- Conversion logic helpers ---

async function attemptConvertPath(files: FileData[], path: ConvertPathNode[], batchMsg?: string) {
    const pathString = path.map(c => c.format.format).join(" \u2192 ");

    const messageHTML = batchMsg
        ? `${batchMsg}<br><span class="muted-text">${pathString}</span>`
        : `<span class="conversion-path">${pathString}</span>`;

    // stabilization delay: only show the detailed path if it doesn't fail immediately
    let uiTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        showConversionInProgress(messageHTML, (window as any)._currentConvertingTitle || "Converting...");
        uiTimeout = null;
    }, 150);

    try {
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

                files = (await Promise.all([
                    Promise.resolve(outputFiles),
                    waitForPaint(),
                ]))[0];
                if (files.some(c => !c.bytes.length)) throw "Output is empty.";
            } catch (e) {
                if (isCancelled) return null;
                console.log(path.map(c => c.format.format));
                console.error(handler.name, `${path[i].format.format} \u2192 ${path[i + 1].format.format}`, e);

                const deadEndPath = path.slice(0, i + 2);
                window.traversionGraph.addDeadEndPath(deadEndPath);

                const fallbackMsg = batchMsg
                    ? `${batchMsg}<br><span class="muted-text">Finding best conversion route...</span>`
                    : `Finding best conversion route...`;

                if (uiTimeout) {
                    clearTimeout(uiTimeout);
                    uiTimeout = null;
                }
                showConversionInProgress(fallbackMsg, (window as any)._currentConvertingTitle || "Converting...");
                await waitForPaint();

                return null;
            }
        }
    } finally {
        if (uiTimeout) {
            clearTimeout(uiTimeout);
        }
    }

    return { files, path };
}

window.tryConvertByTraversing = async function (
    files: FileData[],
    from: ConvertPathNode,
    to: ConvertPathNode,
    batchMsg?: string
) {
    window.traversionGraph.clearDeadEndPaths();

    // Add searching listener to update UI
    const searchListener = (state: string, _path: ConvertPathNode[]) => {
        if (state === "searching" && !batchMsg) {
            showConversionInProgress(`Finding best conversion route...`, (window as any)._currentConvertingTitle || "Converting...");
        }
    };
    window.traversionGraph.addPathEventListener(searchListener);

    try {
        // Yield to the browser so the "Getting started..." or finding route UI can paint
        // before we start doing heavy handler initializations or search loops
        await waitForPaint();

        for await (const path of window.traversionGraph.searchPath(from, to, true)) {
            if (isCancelled) break;
            if (path.at(-1)?.handler === to.handler) {
                path[path.length - 1] = to;
            }
            const attempt = await attemptConvertPath(files, path, batchMsg);
            if (attempt) return attempt;
            if (isCancelled) break;
        }
        return null;
    } finally {
        window.traversionGraph.removePathEventListener(searchListener);
    }
};

function showConversionNotFoundPopup(fromFormat: string, toFormat: string) {
    showPopup(
        `<h2>Congratulations! You found a missing feature 🔎</h2>` +
        `<p><b>${fromFormat}</b> to <b>${toFormat}</b> isn't available right now \u2014 but more formats are on the way!</p>` +
        `<p class="muted-text">Try picking a different format, there's loads to choose from!</p>` +
        `<div class="popup-actions">` +
        `<button class="popup-primary" onclick="window.hidePopup()">Got it</button>` +
        `</div>`,
    );
}

async function ensureMinDuration(startTime: number, minMs: number = 600) {
    const elapsed = performance.now() - startTime;
    if (elapsed < minMs) {
        await new Promise(resolve => setTimeout(resolve, minMs - elapsed));
    }
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
                alert("Drop files first to get started.");
                return;
            }

            if (selectedFromIndex.value === null) {
                alert(`Hmm, couldn't figure out ${fileCount > 1 ? "these files'" : "this file's"} format. Try another?`);
                return;
            }
            if (selectedToIndex.value === null) {
                alert("Pick a format to convert to first!");
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

            const convertingTitle = fileCount > 1 ? "Converting your files" : "Converting your file";
            (window as any)._currentConvertingTitle = convertingTitle;

            await waitForPaint();

            showConversionInProgress("Warming up the engines...<br><span class=\"conversion-path\">getting ready to convert</span>", "Starting up");
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

            if (allOutputFiles.length === fileCount && inputFileData.length === 0) {
                const fmt = outputFormat.format.toUpperCase();
                if (fileCount === 1) {
                    const truncName = shortenFileName(inputFiles[0].name, 32);
                    downloadFile(allOutputFiles[0].bytes, allOutputFiles[0].name);
                    showPopup(
                        `<h2>No conversion needed</h2>` +
                        `<p><b>${escapeHTML(truncName)}</b> is already a <b>${escapeHTML(fmt)}</b> file, so there's nothing to convert. Downloading the original for you.</p>` +
                        `<div class="popup-actions">` +
                        `<button class="popup-primary" onclick="window.hidePopup()">Got it</button>` +
                        `</div>`,
                    );
                    return;
                } else {
                    showPopup(
                        `<h2>No conversion needed</h2>` +
                        `<p>These <b>${fileCount} files</b> are already in <b>${escapeHTML(fmt)}</b> format, so there's nothing to convert. Downloading the originals for you.</p>` +
                        `<div class="popup-actions">` +
                        `<button class="popup-primary" onclick="window.hidePopup()">Got it</button>` +
                        `</div>`,
                    );
                    await downloadAsZip(allOutputFiles, `original-files-${getFormattedDate()}.zip`);
                    return;
                }
            }

            await waitForPaint();

            if (fileCount > 1) {
                for (let i = 0; i < inputFileData.length; i++) {
                    if (isCancelled) break;
                    const batchMsg = fileCount > 1
                        ? `Converting file ${i + 1 + (fileCount - inputFileData.length)} of ${fileCount}...`
                        : "";

                    const singleFile = [inputFileData[i]];
                    const output = await window.tryConvertByTraversing(singleFile, inputOption, outputOption, batchMsg);

                    if (!output) {
                        if (isCancelled) break;
                        showConversionNotFoundPopup(inputFormat.format.toUpperCase(), outputFormat.format.toUpperCase());
                        return;
                    }

                    allOutputFiles.push(...output.files);
                }

                if (isCancelled) return;

                setLastConvertedFiles(allOutputFiles);

                if (allOutputFiles.length > 1) {
                    showConversionInProgress("Almost done...", convertingTitle);
                    const h2 = ui.popupBox.querySelector("h2");
                    if (h2) h2.textContent = "Packing your files...";

                    await waitForPaint();

                    await downloadAsZip(allOutputFiles, `frogConvert-${getFormattedDate()}.zip`);
                } else {
                    for (const file of allOutputFiles) {
                        downloadFile(file.bytes, file.name);
                    }
                }

                await ensureMinDuration(conversionStartTime);

                if (isCancelled) return;

                showPopup(
                    `<h2>Files converted! 🎉</h2>` +
                    `<p>${allOutputFiles.length} file${allOutputFiles.length > 1 ? "s" : ""} converted to <b>${escapeHTML(outputFormat.format.toUpperCase())}</b>${allOutputFiles.length > 1 ? " and zipped up for you," : ","} downloading now.</p>` +
                    `<div class="popup-actions">` +
                    `<button class="popup-primary" onclick="window.downloadAgain()">Download again</button>` +
                    `<button onclick="window.hidePopup()">Done</button>` +
                    `</div>`,
                );
                // Delay confetti slightly to let the modal paint first
                setTimeout(() => {
                    const isPopupShowing = ui.popupBox.classList.contains("popup-visible");
                    if (isPopupShowing) triggerConfetti();
                }, 300);
            } else {
                const output = await window.tryConvertByTraversing(inputFileData, inputOption, outputOption);

                if (isCancelled) return;

                await ensureMinDuration(conversionStartTime);

                if (isCancelled) return;

                if (!output) {
                    showConversionNotFoundPopup(inputFormat.format.toUpperCase(), outputFormat.format.toUpperCase());
                    return;
                }

                allOutputFiles.push(...output.files);
                setLastConvertedFiles(allOutputFiles);

                for (const file of output.files) {
                    if (isCancelled) break;
                    downloadFile(file.bytes, file.name);
                }

                if (isCancelled) return;

                const resultText = fileCount > 1
                    ? `${fileCount} files have been converted to <b>${escapeHTML(outputFormat.format.toUpperCase())}</b> and are downloading now.`
                    : `<b>${escapeHTML(shortenFileName(inputFiles[0].name, 32))}</b> has been converted to <b>${escapeHTML(outputFormat.format.toUpperCase())}</b> and is downloading now.`;

                showPopup(
                    `<h2>File converted! 🎉</h2>` +
                    `<p>${resultText}</p>` +
                    `<div class="popup-actions">` +
                    `<button class="popup-primary" onclick="window.downloadAgain()">Download again</button>` +
                    `<button onclick="window.hidePopup()">Done</button>` +
                    `</div>`,
                );
                // Delay confetti slightly to let the modal paint first
                setTimeout(() => {
                    const isPopupShowing = ui.popupBox.classList.contains("popup-visible");
                    if (isPopupShowing) triggerConfetti();
                }, 300);
            }
        } catch (e) {
            if (isCancelled) return;
            console.error(e);
            showPopup(
                `<h2>Something went wrong</h2>` +
                `<p>${escapeHTML(String(e))}</p>` +
                `<div class="popup-actions">` +
                `<button class="popup-primary" onclick="window.hidePopup()">Got it</button>` +
                `</div>`,
            );
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
