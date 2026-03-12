import CommonFormats from '../core/CommonFormats/CommonFormats.ts';
import type { FileFormat } from "../core/FormatHandler/FormatHandler.ts";
import { TextFormatHandler } from "../core/FormatHandler/TextFormatHandler.ts";

class csharpHandler extends TextFormatHandler {

  public name = "csharpHandler";

  public supportedFormats: FileFormat[] = [
    CommonFormats.TEXT.supported("txt", true, false, true),
    {
      name: "C# Source File",
      format: "cs",
      extension: "cs",
      mime: "text/csharp",
      from: false,
      to: true,
      internal: "csharp",
      category: "code",
      lossless: true,
    }
  ];

  async doConvertText(
    inputTexts: { name: string, text: string }[],
    inputFormat: FileFormat,
    outputFormat: FileFormat,
  ): Promise<{ name: string, text: string }[]> {
    if (inputFormat.internal !== "txt") {
      throw "Invalid input format.";
    }

    if (outputFormat.internal !== "csharp") {
      throw "Invalid output format.";
    }

    return inputTexts.map(file => {
      const escapedText = file.text
        .replace(/\r\n/g, "\n")
        .replaceAll("\"", "\"\"");

      let output = "using System;\n\n";
      output += `Console.WriteLine(@"${escapedText}");\n\n`;
      output += "Console.Read();\n";

      return {
        name: this.replaceExtension(file.name, "cs"),
        text: output
      };
    });
  }
}

export default csharpHandler;
