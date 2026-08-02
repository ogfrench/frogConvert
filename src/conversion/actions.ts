import normalizeMimeType from "../core/utils/normalizeMimeType.ts";
import { downloadFile, downloadAsZip, timestampForFilename } from "./download.ts";
import { isSafari } from "../tools/pdfThumbnails.ts";
import type { FileFormat, FormatHandler, FileData, ConvertPathNode, ProgressEvent, QualityPreset, Notice } from "../core/FormatHandler/FormatHandler.ts";
import { triggerConfetti } from "../effects/Confetti/Confetti.ts";
import {
    ui,
    currentFiles,
    selectedFromIndex,
    selectedToIndex,
    allOptionsRef,
    CATEGORY_LABELS,
    convertQuality,
    CONVERT_QUALITY_CHOICES,
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
    setCanHardCancel,
    setCurrentFileProgress,
    setActiveConversionMode,
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
    isOffline,
    OFFLINE_MESSAGE,
    type UserErrorInfo,
} from "../components/utils/index.ts";
import { runInWorker, WORKER_TIMEOUT_MS } from "./workerClient.ts";
import { hopQualityArgs, resolveAutoQuality } from "../core/compression/hopQuality.ts";

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
/**
 * The quality the last route actually ran at, with "Automatic" already
 * resolved to the tier it chose.
 *
 * The Converter defaults to Original quality, so any other value is a setting
 * the user went and changed - and until now the only confirmation that it had
 * been honoured was the file size, on a conversion where the format change
 * moves that anyway. Naming the level is the honest version: it reports the
 * setting, not a saving it cannot attribute.
 */
let _lastAppliedQuality: QualityPreset | null = null;

/**
 * Whether the engine that produced the output reads `--quality` at all.
 *
 * Distinct from `_lastAppliedQuality` being null, which is also what you get
 * when the user simply asked for Original quality. Only this tells the modal
 * the difference between "you asked for nothing" and "you asked for something
 * this format cannot do".
 */
let _lastQualityApplicable = true;

/** Called once after a conversion completes, then cleared. Used to defer work that is unsafe to run mid-conversion. */
let onConversionEnd: (() => void) | null = null;
export function setOnConversionEnd(fn: (() => void) | null) {
    onConversionEnd = fn;
}

// --- Format matching ---

// Moved to core/FormatHandler/detectFormat.ts so surfaces can detect a file's
// format without importing this module. Re-exported for existing callers.
export { findMatchingFormat } from "../core/FormatHandler/detectFormat.ts";

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

    // "Automatic" reads the sources and picks a tier once for the whole route,
    // so an already-low-quality input isn't squeezed a second time.
    const requestedQuality: QualityPreset = convertQuality.value === "auto"
        ? await resolveAutoQuality(
            files.map(f => ({ bytes: f.bytes, mime: path[0]?.format.mime ?? "" })),
        )
        : convertQuality.value;
    // Kept for the success modal, which is the only place the user finds out
    // this happened. Automatic resolves to a real tier here and nowhere else,
    // so recording the resolved answer is the only way to name it afterwards.
    //
    // Only claim it where it can be true. This used to be set from the setting
    // alone, so converting to a container format announced "Compressed at
    // Smallest file" while `jszip` - which never reads `--quality` - handed
    // back a file 126 bytes *larger* than the input. The last hop is the one
    // that produces the artifact the user keeps, so it is the only hop whose
    // opinion counts; a lossless target opts out wherever it appears.
    // `path.length >= 2` is load-bearing, not a null-check. A single-node path
    // is zero hops: the loop below runs no steps and the input is handed back
    // untouched, but `path[path.length - 1]` would then be the *source* node -
    // so a PNG under ImageMagick would report a compression that, once again,
    // never ran.
    const finalHop = path.length >= 2 ? path[path.length - 1] : undefined;
    _lastQualityApplicable = !!finalHop?.handler?.usesQuality && !finalHop.format.lossless;
    _lastAppliedQuality = _lastQualityApplicable ? requestedQuality : null;

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

            // One shared rule across every surface, so the browser, MCP, REST
            // and CLI all reduce quality once rather than at each hop.
            const hopArgs = hopQualityArgs({
                target: path[i + 1].format,
                isLastHop,
                requested: requestedQuality,
            });

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

/** Shared with the Compress surface, which has the same long waits. */
export const REASSURANCE_LINE = "feel free to switch tabs";

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

    // Offline outranks every other diagnosis. The converters are fetched on
    // first use, so with no network the failure is always the download and
    // never the file - and "the converter isn't available yet" would send
    // someone hunting for a problem that reconnecting fixes.
    if (isOffline()) {
        showAlertPopup("You're offline", escapeHTML(OFFLINE_MESSAGE));
        return;
    }

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

    // The engine, not the file. Said before anything else, because every other
    // message here would send the user to look at their document.
    if (error.kind === "engine_download") {
        showAlertPopup("Couldn't download the converter", escapeHTML(error.message));
        return;
    }

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

/**
 * The one sentence the success modal says about what just happened.
 *
 * Pulled out of the click handler so it can be read and tested on its own -
 * the handler around it needs a format graph, live handlers and a popup to
 * reach this point, which is why the copy went unverified for so long.
 *
 * Returns HTML: the caller assigns it with innerHTML, so every interpolated
 * value is escaped here.
 */
export function conversionResultText(opts: {
    /** Files the user dropped. */
    fileCount: number;
    /** Files produced. Not always the same number. */
    outCount: number;
    firstInputName: string;
    /** Target format, upper-cased. */
    format: string;
    /** "converted" / "compressed", from the active mode. */
    verb: string;
    /** Level the route ran at, Automatic already resolved. Null when none ran. */
    applied: QualityPreset | null;
    /** What the *setting* says, so Automatic can be named as Automatic. */
    requested: string;
    /**
     * Whether the target format's engine reads the quality argument at all.
     * False for containers like ZIP and for the ~35 handlers that ignore it.
     * Defaults to true so existing callers keep their behaviour.
     */
    qualityApplies?: boolean;
}): string {
    const { fileCount, outCount, firstInputName, verb, applied, requested } = opts;
    const qualityApplies = opts.qualityApplies ?? true;
    const fmt = escapeHTML(opts.format);
    const first = `<b>${escapeHTML(shortenFileName(firstInputName, 32))}</b>`;

    // How many went in, and how many came out.
    //
    // These are not always the same number, and this used to report the output
    // count as though it were the input one - so a single 3-page PDF converted
    // to EPS, which the format requires to be one file per page, announced
    // "3 files converted". The user converted one. Where they differ, say
    // both: the second number is the surprising one, and is the whole reason
    // this release had to document the behaviour.
    let text: string;
    if (outCount > fileCount) {
        const subject = fileCount === 1 ? first : `${fileCount} files`;
        text = `${subject} became <b>${outCount} ${fmt} files</b>, one per page, zipped up and ready to download.`;
    } else if (outCount > 1) {
        text = `${outCount} files ${verb} to <b>${fmt}</b> and zipped up, ready to download.`;
    } else {
        text = `${first} has been ${verb} to <b>${fmt}</b> and is ready to download.`;
    }

    // One clause when the conversion also compressed, and nothing at all when
    // it did not.
    //
    // The Converter defaults to Original quality, so reaching this at any
    // other level means the user went to the settings menu and asked for it.
    // Confirming it was honoured is the least the modal can do; until now the
    // only evidence was the file size, on the one operation where the format
    // change moves that anyway.
    //
    // It names the level rather than a saving, deliberately. A PNG -> JPG is
    // smaller because it is a JPEG, and crediting that to the compression dial
    // would be a number the app cannot stand behind. The level is a fact about
    // what was asked for and done. Automatic is named by the tier it resolved
    // to *and* as Automatic, since "Balanced" alone would look like a setting
    // the user never chose.
    if (applied && applied !== "lossless") {
        // Label from the shared menu, so the modal cannot call a level
        // something the settings menu does not.
        const label = CONVERT_QUALITY_CHOICES.find(c => c.value === applied)?.label ?? applied;
        const suffix = requested === "auto" ? " (Automatic)" : "";
        text += ` Compressed at <b>${escapeHTML(label)}</b>${escapeHTML(suffix)}.`;
    } else if (!qualityApplies && requested !== "lossless") {
        // The user went to the settings menu, chose a level, and it did
        // nothing - because this target has no quality knob to turn. Saying so
        // costs one clause and answers the question they are about to ask,
        // which is why the file did not get smaller. Naming the format matters:
        // "doesn't apply here" invites "where does it apply, then?".
        text += ` Your compression level doesn't apply to <b>${fmt}</b>, so the converted file was not compressed and left as-is.`;
    }
    return text;
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
            _lastAppliedQuality = null;
            _lastQualityApplicable = true;

            const inputOption = allOptionsRef.value[selectedFromIndex.value];
            const outputOption = allOptionsRef.value[selectedToIndex.value];

            const inputFormat = inputOption.format;
            const outputFormat = outputOption.format;

            const isSameFormatPick = inputFormat.mime === outputFormat.mime
                && inputFormat.format === outputFormat.format;

            _convertingTitle = `Converting your ${fileCount > 1 ? "files" : "file"}`;

            setActiveConversionMode("convert");

            await waitForPaint();

            const startupStartTime = performance.now();
            showConversionInProgress(`Reading your ${fileCount > 1 ? "files" : "file"}...<br><span class="conversion-path">getting ready to convert</span>`, _convertingTitle, "idle");
            await waitForPaint();

            const inputFileData: FileData[] = [];
            // Files picked with input format === output format. These are
            // passed through untouched - see the loop below that pushes them
            // straight into the outputs. Recompressing in place is the Compress
            // surface's job, and the format modal signposts it.
            //
            // (This comment used to claim they were "compressed inline by the
            // same-format dispatcher", which stopped being true when the
            // easter egg was stripped and directly contradicted the comment 25
            // lines down.)
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

            // Same-format picks convert nothing, so they pass straight
            // through. Recompressing in place lives on the Compress surface.
            for (const f of sameFormatRaw) allOutputFiles.push(f);

            if (isCancelled) return;

            // Same-format batch: nothing to convert, so there is no path to
            // find. Hand back the originals.
            if (inputFileData.length === 0) {
                await ensureMinDuration(conversionStartTime);
                const fmt = outputFormat.format.toUpperCase();
                if (fileCount === 1) {
                    downloadFile(allOutputFiles[0].bytes, allOutputFiles[0].name);
                    showAlertPopup("No conversion needed", `<b>${escapeHTML(shortenFileName(inputFiles[0].name, 32))}</b> is already a <b>${escapeHTML(fmt)}</b> file, so there's nothing to convert. Downloading the original for you.`);
                } else {
                    showAlertPopup("No conversion needed", `These <b>${fileCount} files</b> are already in <b>${escapeHTML(fmt)}</b> format, so there's nothing to convert. Downloading the originals for you.`);
                    await downloadAsZip(allOutputFiles, `original-files-${timestampForFilename()}.zip`);
                }
                return;
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
            // Title follows user intent (_activeMode), not byte shrinkage. A
            // cross-format convert that happens to shrink shouldn't rename
            // itself "File compressed!" on the success popup.
            const successTitle = isBatch ? modeCopy().successTitleBatch : modeCopy().successTitleSingle;
            const resultText = conversionResultText({
                fileCount,
                outCount: allOutputFiles.length,
                firstInputName: inputFiles[0].name,
                format: outputFormat.format.toUpperCase(),
                verb: modeCopy().verb,
                applied: _lastAppliedQuality,
                requested: convertQuality.value,
                qualityApplies: _lastQualityApplicable,
            });

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
            // Names the result rather than the gesture. "Download again" was
            // both wrong - nothing had been downloaded yet - and vaguer than
            // the Compress card sitting one surface away, which has always
            // said how many files and in what shape.
            const dlLabel = allOutputFiles.length > 1
                ? `Download ${allOutputFiles.length} files (.zip)`
                : "Download";
            actions.appendChild(createPopupButton(dlLabel, "btn-primary", () => downloadAllConvertedFiles()));
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

            // Deliberately no automatic download.
            //
            // A file arriving in Downloads without being asked for is a
            // decision made on the user's behalf, in the one place they can
            // still say no: a conversion they got wrong, a level they want to
            // change, a batch they only wanted to look at. The button below
            // names exactly what it will produce, so pressing it is the whole
            // transaction and nothing happens before it.
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
                // Every entry here is a real conversion output, so a cancelled
                // run offers all of the ones that finished.
                //
                // This used to branch on compression mode and filter by
                // `originalBytes`, a field nothing in the codebase has ever
                // set - so the filter always emptied the list. It never fired
                // because Compress does not run through this handler at all
                // (it has its own loop and its own results card, and is the
                // only caller of `setActiveConversionMode("compress")`). Two
                // dead paths keyed on a dead field.
                const meaningfulFiles = allOutputFiles;
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
