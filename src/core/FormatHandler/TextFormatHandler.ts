import { BaseHandler } from "./BaseHandler.ts";
import type { FileData, FileFormat } from "./FormatHandler.ts";

export abstract class TextFormatHandler extends BaseHandler {
    protected decoder = new TextDecoder();
    protected encoder = new TextEncoder();

    abstract doConvertText(
        inputTexts: { name: string, text: string }[],
        inputFormat: FileFormat,
        outputFormat: FileFormat
    ): Promise<{ name: string, text: string }[]>;

    async doConvert(
        inputFiles: FileData[],
        inputFormat: FileFormat,
        outputFormat: FileFormat
    ): Promise<FileData[]> {
        const inputTexts = inputFiles.map(file => ({
            name: file.name,
            text: this.decoder.decode(file.bytes),
        }));

        const outputTexts = await this.doConvertText(inputTexts, inputFormat, outputFormat);

        return outputTexts.map(out => ({
            name: out.name,
            bytes: this.encoder.encode(out.text)
        }));
    }
}
