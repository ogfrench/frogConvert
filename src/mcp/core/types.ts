import type { FormatHandler } from '../../core/FormatHandler/FormatHandler.ts';
import type { TraversionGraph } from '../../core/TraversionGraph/TraversionGraph.ts';

export interface McpContext {
    handlers: FormatHandler[];
    graph: TraversionGraph;
}
