import type { FileFormat, FileData, ConvertPathNode } from "./core/FormatHandler/FormatHandler.js";
import type { TraversionGraph } from "./core/TraversionGraph/TraversionGraph.js";

declare global {
  interface Window {
    supportedFormatCache: Map<string, FileFormat[]>;
    traversionGraph: TraversionGraph;
    printSupportedFormatCache: () => string;
    showPopup: (html: string) => void;
    hidePopup: () => void;
    downloadAgain: () => void;
    tryConvertByTraversing: (files: FileData[], from: ConvertPathNode, to: ConvertPathNode, batchMsg?: string) => Promise<{
      files: FileData[];
      path: ConvertPathNode[];
    } | null>;
  }
}

export { };
