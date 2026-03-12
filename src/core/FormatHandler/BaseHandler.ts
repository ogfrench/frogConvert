import type { FileData, FileFormat, FormatHandler } from "./FormatHandler.ts";

export abstract class BaseHandler implements FormatHandler {
    public abstract name: string;
    public abstract supportedFormats: FileFormat[];
    public ready: boolean = true;

    async init(): Promise<void> {
        this.ready = true;
    }

    protected replaceExtension(filename: string, newExt: string): string {
        const parts = filename.split(".");
        if (parts.length > 1) {
            parts.pop();
        }
        return parts.join(".") + (newExt.startsWith(".") ? newExt : "." + newExt);
    }

    abstract doConvert(
        inputFiles: FileData[],
        inputFormat: FileFormat,
        outputFormat: FileFormat
    ): Promise<FileData[]>;
}
