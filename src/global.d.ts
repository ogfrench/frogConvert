import type { FileFormat } from "./core/FormatHandler/FormatHandler.js";
import type { TraversionGraph } from "./core/TraversionGraph/TraversionGraph.js";

declare global {
  interface Window {
    supportedFormatCache: Map<string, FileFormat[]>;
    traversionGraph: TraversionGraph;
    printSupportedFormatCache: () => string;
    showPopup: (html: string) => void;
    hidePopup: () => void;
  }
}

export { };
