import JSON5 from "json5";
import CommonFormats from "../core/CommonFormats/CommonFormats.ts";
import { FormatDefinition, type FileData, type FileFormat, type FormatHandler } from "../core/FormatHandler/FormatHandler.ts";

const JSON5_FORMAT = new FormatDefinition(
  "JSON5",
  "json5",
  "json5",
  "application/json5",
  "data",
).supported("json5", true, true, true);

class json5Handler implements FormatHandler {
  public name: string = "json5";
  public ready: boolean = true;

  public supportedFormats: FileFormat[] = [
    CommonFormats.JSON.supported("json", true, true, true),
    JSON5_FORMAT,
  ];

  async init() {
    this.ready = true;
  }

  async doConvert(
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat,
  ): Promise<FileData[]> {
    return inputFiles.map(file => {
      const baseName = file.name.replace(/\.[^.]+$/u, "");
      const object = inputFormat.internal === "json5"
        ? JSON5.parse(new TextDecoder().decode(file.bytes))
        : JSON.parse(new TextDecoder().decode(file.bytes));
      const text = outputFormat.internal === "json5"
        ? JSON5.stringify(object, null, 2)
        : JSON.stringify(object);

      return {
        name: `${baseName}.${outputFormat.extension}`,
        bytes: new TextEncoder().encode(text),
      };
    });
  }
}

export default json5Handler;
