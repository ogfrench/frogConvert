import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initUploadZone, showFileInUploadZone, resetUploadZone } from "./UploadZone.ts";
import { ui, currentFiles } from "../store/store.ts";

describe("UploadZone DOM bindings", () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="upload-zone">
                <input type="file" id="file-input" />
                <div id="upload-text">Drop your files</div>
                <div class="upload-hint">or click to browse</div>
                <div class="upload-file-info">
                    <span class="upload-file-name"></span>
                </div>
                <label id="upload-label">Your file</label>
                <button id="remove-file-btn">Remove</button>
                <button id="replace-file-btn">Replace</button>
                <button id="expand-files-btn">Expand</button>
            </div>
        `;
        ui.uploadZone = document.getElementById("upload-zone") as HTMLDivElement;
        ui.fileInput = document.getElementById("file-input") as HTMLInputElement;
        ui.uploadText = document.getElementById("upload-text") as HTMLParagraphElement;
        ui.uploadHint = document.querySelector(".upload-hint") as HTMLParagraphElement;
        ui.uploadFileInfo = document.querySelector(".upload-file-info") as HTMLDivElement;
        ui.uploadFileName = document.querySelector(".upload-file-name") as HTMLSpanElement;
        ui.uploadLabel = document.getElementById("upload-label") as HTMLLabelElement;
        ui.removeFileBtn = document.getElementById("remove-file-btn") as HTMLButtonElement;
        ui.replaceFileBtn = document.getElementById("replace-file-btn") as HTMLButtonElement;
        ui.expandFilesBtn = document.getElementById("expand-files-btn") as HTMLButtonElement;

        currentFiles.value = [];
    });

    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("toggles drag-over class on drag events", () => {
        initUploadZone(() => { }, () => { });

        // bindDragAndDropVisuals listens on window and guards on dataTransfer.types
        const makeFileDragEvent = (type: string) => {
            const ev = new Event(type, { bubbles: true });
            Object.defineProperty(ev, "dataTransfer", { value: { types: ["Files"] } });
            return ev;
        };

        window.dispatchEvent(makeFileDragEvent("dragenter"));
        expect(ui.uploadZone.classList.contains("drag-over")).toBe(true);

        window.dispatchEvent(makeFileDragEvent("dragleave"));
        expect(ui.uploadZone.classList.contains("drag-over")).toBe(false);
    });

    describe("showFileInUploadZone display and DOM", () => {
        it("displays files in the zone and updates DOM correctly", () => {
            const fakeFile = new File(["dummy content"], "dummy.png", { type: "image/png" });
            showFileInUploadZone([fakeFile]);

            expect(ui.uploadText.style.display).toBe("none");
            expect(ui.uploadHint.style.display).toBe("none");
            expect(ui.uploadFileName.textContent).toBe("dummy.png");
            expect(ui.uploadLabel.textContent).toBe("Your file");
            expect(ui.uploadFileInfo.classList.contains("visible")).toBe(true);
            expect(ui.uploadZone.classList.contains("has-file")).toBe(true);
        });

        it("shows '{n} files selected' and (+N more) display name for multiple files", () => {
            const fileA = new File(["A"], "a.png", { type: "image/png" });
            const fileB = new File(["B"], "b.png", { type: "image/png" });
            showFileInUploadZone([fileA, fileB]);

            expect(ui.uploadFileName.textContent).toContain("a.png");
            expect(ui.uploadFileName.textContent).toContain("(+1 more)");
            expect(ui.uploadLabel.textContent).toBe("2 files selected");
        });

        it("truncates a long file name in multi-file mode", () => {
            const longName = "a".repeat(30) + ".png";
            const fileLong = new File(["Long"], longName, { type: "image/png" });
            const fileB = new File(["B"], "b.png", { type: "image/png" });
            showFileInUploadZone([fileLong, fileB]);

            expect(ui.uploadFileName.textContent).toContain("...");
            expect(ui.uploadFileName.textContent).toContain("(+1 more)");
        });
    });

    describe("showDetectedFormat", () => {
        // We can test this by importing it and calling it, it mutates ui.uploadLabel
        it("shows 'Ready to convert from FORMAT' for a single file", async () => {
            const { showDetectedFormat } = await import("./UploadZone.ts");
            showDetectedFormat("mp3", 1);
            expect(ui.uploadLabel.textContent).toBe("Ready to convert from MP3");
        });

        it("shows '{n} files ready - converting from FORMAT' for multiple files", async () => {
            const { showDetectedFormat } = await import("./UploadZone.ts");
            showDetectedFormat("png", 3);
            expect(ui.uploadLabel.textContent).toBe("3 files ready \u2014 converting from PNG");
        });
    });

    it("resets DOM correctly when resetUploadZone is called", () => {
        const fakeFile = new File(["dummy content"], "dummy.png", { type: "image/png" });
        showFileInUploadZone([fakeFile]);
        resetUploadZone();

        expect(ui.fileInput.value).toBe("");
        expect(ui.uploadText.style.display).toBe("");
        expect(ui.uploadHint.style.display).toBe("");
        expect(ui.uploadFileInfo.classList.contains("visible")).toBe(false);
        expect(ui.uploadFileName.textContent).toBe("");
        expect(ui.uploadZone.classList.contains("has-file")).toBe(false);
        expect(currentFiles.value.length).toBe(0);
    });
});
