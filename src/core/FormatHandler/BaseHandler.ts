import type { FileData, FileFormat, FormatHandler } from "./FormatHandler.ts";

export abstract class BaseHandler implements FormatHandler {
    public abstract name: string;
    public abstract supportedFormats: FileFormat[];
    public ready: boolean = true;

    async init(): Promise<void> {
        this.ready = true;
    }

    protected replaceExtension(filename: string, newExt: string): string {
        const dot = filename.lastIndexOf(".");
        const base = dot !== -1 ? filename.slice(0, dot) : filename;
        return base + (newExt.startsWith(".") ? newExt : "." + newExt);
    }

    abstract doConvert(
        inputFiles: FileData[],
        inputFormat: FileFormat,
        outputFormat: FileFormat
    ): Promise<FileData[]>;
}
