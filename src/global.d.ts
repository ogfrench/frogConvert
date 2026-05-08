/// <reference types="vite-plugin-pwa/client" />

import type { FileFormat } from "./core/FormatHandler/FormatHandler.js";
import type { TraversionGraph } from "./core/TraversionGraph/TraversionGraph.js";

declare global {
  interface Window {
    supportedFormatCache: Map<string, FileFormat[]>;
    traversionGraph: TraversionGraph;
    printSupportedFormatCache: () => string;
    showPopup: (html: string) => void;
    hidePopup: () => void;
    launchQueue?: {
      setConsumer(consumer: (params: { files: ReadonlyArray<FileSystemFileHandle> }) => void): void;
    };
  }

  interface ImportMetaEnv {
    readonly VITE_APP_NAME: string;
    readonly VITE_BUILD_TIME: string;
    readonly VITE_COMMIT_SHA: string;
    readonly VITE_IS_DESKTOP: boolean;
    readonly VITE_NAV_DOCS: string;
  }
}

export { };
