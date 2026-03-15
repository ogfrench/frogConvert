import type { FileData, FileFormat, FormatHandler } from "../core/FormatHandler/FormatHandler.ts";
import CommonFormats from '../core/CommonFormats/CommonFormats.ts';

class svgTraceHandler implements FormatHandler {

  public name: string = "svgTrace";
  public supportedFormats?: FileFormat[];
  public ready: boolean = false;
  public requiresMainThread: boolean = true;

  async init() {
    this.supportedFormats = [
      CommonFormats.PNG.builder("png").allowFrom(),
      CommonFormats.JPEG.builder("jpeg").allowFrom(),
      // note there is both animated svgs, and animted webPs, although this converter does not support either
      CommonFormats.WEBP.builder("webp").allowFrom(),
      CommonFormats.SVG.builder("svg").allowTo()
    ];
    this.ready = true;
  }

  async doConvert(
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {
    if (outputFormat.internal !== "svg") throw "Invalid output format.";

    const outputFiles: FileData[] = [];
    const encoder = new TextEncoder();
    const { imageTracer } = await import('imagetracer');

    for (const inputFile of inputFiles) {
      const blob = new Blob([inputFile.bytes as BlobPart], { type: inputFormat.mime });
      const url = URL.createObjectURL(blob);
      const traced = await imageTracer.imageToSVG(url); // return the full svg string
      URL.revokeObjectURL(url);
      const name = inputFile.name.split(".")[0] + ".svg";
      const bytes = encoder.encode(traced);


      outputFiles.push({ bytes, name });
    }
    return outputFiles;
  }

}

export default svgTraceHandler;
