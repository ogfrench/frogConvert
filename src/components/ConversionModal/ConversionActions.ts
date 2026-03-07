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
    shortenFileName,
    escapeHTML,
    showPopup,
    isCancelled,
    resetCancellation,
    showConversionInProgress,
    setWorkerCancelCallback,
    completeCancellation
} from "../index.ts";

// --- Helpers ---

const waitForPaint = () => new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
);

let isConverting = false;
export const getIsConverting = () => isConverting;

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
        await downloadAsZip(lastConvertedFiles, `converted_files_${Date.now()}.zip`);
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
        ? `${batchMsg}<br><span class="muted-text">Converting using the following steps: ${pathString}</span>`
        : `Converting your file to <b>${path.at(-1)!.format.format.toUpperCase()}</b>...<br><br><div style="font-size: 0.9em; padding: 6px; background: rgba(0,0,0,0.05); border-radius: 6px;">Converting using the following steps:<br><b>${pathString}</b></div>`;

    // stabilization delay: only show the detailed path if it doesn't fail immediately
    let uiTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        showConversionInProgress(messageHTML);
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
                showConversionInProgress(fallbackMsg);
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
            showConversionInProgress(`Finding best conversion route...`);
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
                showPopup(
                    `<h2>Still loading...</h2>` +
                    `<p>Formats are still loading. Try again in a moment.</p>` +
                    `<div class="popup-actions">` +
                    `<button class="popup-primary" onclick="window.hidePopup()">Got it</button>` +
                    `</div>`,
                );
                return;
            }

            const inputOption = allOptionsRef.value[selectedFromIndex.value];
            const outputOption = allOptionsRef.value[selectedToIndex.value];

            const inputFormat = inputOption.format;
            const outputFormat = outputOption.format;

            const conversionStartTime = performance.now();
            resetCancellation();

            const inputFileData: FileData[] = [];
            const allOutputFiles: { name: string; bytes: Uint8Array }[] = [];

            for (const inputFile of inputFiles) {
                if (isCancelled) return;
                const inputBuffer = await inputFile.arrayBuffer();
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
                        `<h2>Nothing to do!</h2>` +
                        `<p><b>${escapeHTML(truncName)}</b> is already a <b>${escapeHTML(fmt)}</b> file, so nothing to convert. Downloading the original for you.</p>` +
                        `<div class="popup-actions">` +
                        `<button class="popup-primary" onclick="window.hidePopup()">Got it</button>` +
                        `</div>`,
                    );
                    return;
                } else {
                    showPopup(
                        `<h2>Nothing to do!</h2>` +
                        `<p>These <b>${fileCount} files</b> are already in <b>${escapeHTML(fmt)}</b> format, so nothing to convert. Downloading the originals for you.</p>` +
                        `<div class="popup-actions">` +
                        `<button class="popup-primary" onclick="window.hidePopup()">Got it</button>` +
                        `</div>`,
                    );
                    await downloadAsZip(allOutputFiles, "original-files.zip");
                    return;
                }
            }

            await waitForPaint();

            if (fileCount > 1) {
                showConversionInProgress("Getting started...");

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
                    showConversionInProgress("Almost done...");
                    const h2 = ui.popupBox.querySelector("h2");
                    if (h2) h2.textContent = "Packing your files...";

                    await waitForPaint();

                    await downloadAsZip(allOutputFiles, "frogConvert-files.zip");
                } else {
                    for (const file of allOutputFiles) {
                        downloadFile(file.bytes, file.name);
                    }
                }

                await ensureMinDuration(conversionStartTime);

                if (isCancelled) return;

                showPopup(
                    `<h2>All done! 🎉</h2>` +
                    `<p>${allOutputFiles.length} file${allOutputFiles.length > 1 ? "s" : ""} converted to <b>${escapeHTML(outputFormat.format.toUpperCase())}</b>${allOutputFiles.length > 1 ? " and zipped up for you," : ","} downloading now.</p>` +
                    `<div class="popup-actions">` +
                    `<button class="popup-primary" onclick="window.downloadAgain()">Download again</button>` +
                    `<button onclick="window.hidePopup()">Done</button>` +
                    `</div>`,
                );
                triggerConfetti();
            } else {
                const output = await window.tryConvertByTraversing(inputFileData, inputOption, outputOption);

                if (isCancelled) return;

                await ensureMinDuration(conversionStartTime);

                if (isCancelled) return;

                if (!output) {
                    showConversionNotFoundPopup(inputFormat.format.toUpperCase(), outputFormat.format.toUpperCase());
                    return;
                }

                setLastConvertedFiles(output.files);

                for (const file of output.files) {
                    if (isCancelled) break;
                    downloadFile(file.bytes, file.name);
                }

                if (isCancelled) return;

                const resultText = fileCount > 1
                    ? `${fileCount} files have been converted to <b>${escapeHTML(outputFormat.format.toUpperCase())}</b> and are downloading now.`
                    : `<b>${escapeHTML(shortenFileName(inputFiles[0].name, 32))}</b> has been converted to <b>${escapeHTML(outputFormat.format.toUpperCase())}</b> and is downloading now.`;

                showPopup(
                    `<h2>All done! 🎉</h2>` +
                    `<p>${resultText}</p>` +
                    `<div class="popup-actions">` +
                    `<button class="popup-primary" onclick="window.downloadAgain()">Download again</button>` +
                    `<button onclick="window.hidePopup()">Done</button>` +
                    `</div>`,
                );
                triggerConfetti();
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
            await completeCancellation();
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
