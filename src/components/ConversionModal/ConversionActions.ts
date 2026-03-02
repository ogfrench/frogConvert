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
    hidePopup,
    isCancelled,
    resetCancellation,
    showConversionInProgress,
    isCancellationConfirming
} from "../index.ts";

// --- Helpers ---

const waitForPaint = () => new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
);

let isConverting = false;

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

// --- Conversion logic helpers ---

async function attemptConvertPath(files: FileData[], path: ConvertPathNode[], batchMsg?: string) {
    const pathString = path.map(c => c.format.format).join(" \u2192 ");

    const messageHTML = batchMsg
        ? `${batchMsg}<br><span class="muted-text">Finding the best path...</span>`
        : `Converting your file to <b>${path.at(-1)!.format.format.toUpperCase()}</b>...`;

    showConversionInProgress(messageHTML);

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
            )!;
            files = (await Promise.all([
                handler.doConvert(files, inputFormat, path[i + 1].format),
                waitForPaint(),
            ]))[0];
            if (files.some(c => !c.bytes.length)) throw "Output is empty.";
        } catch (e) {
            console.log(path.map(c => c.format.format));
            console.error(handler.name, `${path[i].format.format} \u2192 ${path[i + 1].format.format}`, e);

            const deadEndPath = path.slice(0, i + 2);
            window.traversionGraph.addDeadEndPath(deadEndPath);

            const fallbackMsg = batchMsg
                ? `${batchMsg}<br><span class="muted-text">Trying a different approach...</span>`
                : `Trying a different approach...`;

            showConversionInProgress(fallbackMsg);
            await waitForPaint();

            return null;
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
    for await (const path of window.traversionGraph.searchPath(from, to, true)) {
        if (isCancelled) break;
        if (path.at(-1)?.handler === to.handler) {
            path[path.length - 1] = to;
        }
        const attempt = await attemptConvertPath(files, path, batchMsg);
        if (attempt) return attempt;
    }
    return null;
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
    triggerConfetti();
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
        const inputFiles = currentFiles.value;
        const fileCount = inputFiles.length;

        if (fileCount === 0) {
            alert("Drop a file first to get started.");
            isConverting = false;
            return;
        }

        if (selectedFromIndex.value === null) {
            alert("Hmm, couldn't figure out this file's format. Try another?");
            isConverting = false;
            return;
        }
        if (selectedToIndex.value === null) {
            alert("Pick a format to convert to first!");
            isConverting = false;
            return;
        }

        const inputOption = allOptionsRef.value[selectedFromIndex.value];
        const outputOption = allOptionsRef.value[selectedToIndex.value];

        const inputFormat = inputOption.format;
        const outputFormat = outputOption.format;

        const conversionStartTime = performance.now();
        resetCancellation();

        try {
            const inputFileData: FileData[] = [];
            const allOutputFiles: { name: string; bytes: Uint8Array }[] = [];

            for (const inputFile of inputFiles) {
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
                        `<p><b>${escapeHTML(truncName)}</b> is already a <b>${escapeHTML(fmt)}</b> file - no conversion needed.</p>` +
                        `<div class="popup-actions">` +
                        `<button class="popup-primary" onclick="window.hidePopup()">Got it</button>` +
                        `</div>`,
                    );
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
                        if (isCancelled || isCancellationConfirming()) break;
                        showConversionNotFoundPopup(inputFormat.format.toUpperCase(), outputFormat.format.toUpperCase());
                        return;
                    }

                    allOutputFiles.push(...output.files);
                }

                if (isCancelled) {
                    resetCancellation();
                    return;
                }

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

                if (isCancelled || isCancellationConfirming()) {
                    resetCancellation();
                    return;
                }

                showPopup(
                    `<h2>All done! 🎉</h2>` +
                    `<p>${allOutputFiles.length} file${allOutputFiles.length > 1 ? "s" : ""} converted to <b>${escapeHTML(outputFormat.format.toUpperCase())}</b> and downloading now.</p>` +
                    `<div class="popup-actions">` +
                    `<button class="popup-primary" onclick="window.downloadAgain()">Download again</button>` +
                    `<button onclick="window.hidePopup()">Done</button>` +
                    `</div>`,
                );
            } else {
                const output = await window.tryConvertByTraversing(inputFileData, inputOption, outputOption);

                await ensureMinDuration(conversionStartTime);

                if (!output) {
                    if (isCancelled || isCancellationConfirming()) {
                        resetCancellation();
                        return;
                    }
                    showConversionNotFoundPopup(inputFormat.format.toUpperCase(), outputFormat.format.toUpperCase());
                    return;
                }

                setLastConvertedFiles(output.files);

                for (const file of output.files) {
                    if (isCancelled) break;
                    downloadFile(file.bytes, file.name);
                }

                if (isCancelled || isCancellationConfirming()) {
                    resetCancellation();
                    return;
                }

                const truncatedInputName = shortenFileName(currentFiles.value[0].name, 32);

                showPopup(
                    `<h2>All done! 🎉</h2>` +
                    `<p><b>${escapeHTML(truncatedInputName)}</b> has been converted to <b>${escapeHTML(outputFormat.format.toUpperCase())}</b> and is downloading now.</p>` +
                    `<div class="popup-actions">` +
                    `<button class="popup-primary" onclick="window.downloadAgain()">Download again</button>` +
                    `<button onclick="window.hidePopup()">Done</button>` +
                    `</div>`,
                );
            }
        } catch (e) {
            if (isCancelled) return;
            console.error(e);
            showPopup(
                `<h2>Something went wrong</h2>` +
                `<p>${escapeHTML(String(e))}</p>` +
                `<div class="popup-actions">` +
                `<button class="popup-primary" onclick="window.hidePopup()">OK</button>` +
                `</div>`,
            );
        } finally {
            resetCancellation();
            isConverting = false;
        }
    };
}
