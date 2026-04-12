import type { FormatHandler } from '../../core/FormatHandler/FormatHandler.ts';
import type { TraversionGraph } from '../../core/TraversionGraph/TraversionGraph.ts';

export interface McpContext {
    handlers: FormatHandler[];
    /** All loaded handlers, including those that failed to become ready (e.g. libreoffice without soffice). */
    allHandlers: FormatHandler[];
    graph: TraversionGraph;
}
