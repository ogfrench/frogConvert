import type { FileData, FileFormat, FormatHandler } from "../src/core/FormatHandler/FormatHandler.ts";

/**
 * A mock implementation of the FormatHandler interface for testing purposes.
 * It allows you to specify supported formats and simulate conversions without performing actual processing.
 */
export class MockedHandler implements FormatHandler {
    ready: boolean = false;

    constructor(
        public name: string,
        public supportedFormats?: FileFormat[],
        public supportAnyInput?: boolean,
    ) { }

    init() {
        this.ready = true;
        return Promise.resolve();
    }

    doConvert(inputFiles: FileData[], _inputFormat: FileFormat, _outputFormat: FileFormat, _args?: string[]): Promise<FileData[]> {
        return Promise.resolve(inputFiles);
    }
}