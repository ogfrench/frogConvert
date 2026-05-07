import { PriorityQueue } from '../core/FormatHandler/PriorityQueue.ts';
import type { FileFormat } from '../core/FormatHandler/FormatHandler.ts';

// Types duplicated from TraversionGraph.ts to avoid circular dependencies or exporting internals
export interface Node {
    identifier: string;
    edges: Array<number>;
}

export interface Edge {
    from: { format: FileFormat, index: number };
    to: { format: FileFormat, index: number };
    handler: string;
    cost: number;
}

export interface CategoryAdaptiveCost {
    categories: string[];
    cost: number;
}

export interface SerializableConvertPathNode {
    format: FileFormat;
    handlerName: string;
}

interface QueueNode {
    index: number;
    cost: number;
    path: SerializableConvertPathNode[];
    adaptiveCost: number;
}

export function createWorkerHandler(postMessage: (msg: any) => void) {
    // Global state for this worker instance
    let nodes: Node[] = [];
    let edges: Edge[] = [];
    let categoryAdaptiveCosts: CategoryAdaptiveCost[] = [];

    // Search state
    const SEARCH_TIMEOUT_MS = 12_000; // Slightly under the main-thread 15s timeout

    let queue: PriorityQueue<QueueNode> | null = null;
    // Cost-based pruning: tracks the cheapest known cost to reach each node.
    // Cleared on resume so nodes previously settled via now-dead-ended routes
    // can be re-explored through alternative paths.
    //
    // NOTE: Because adaptive costs are path-dependent (not purely edge-additive),
    // node-level pruning is a pragmatic trade-off. In rare cases, a costlier path
    // TO a node could produce a cheaper path THROUGH it. For the small conversion
    // graphs used in practice, this trade-off is acceptable.
    let bestCost = new Map<number, number>();
    let temporaryDeadEnds: SerializableConvertPathNode[][] = [];
    let iterations = 0;
    let pathsFound = 0;
    let searchStartTime = 0;

    let toIndex = -1;
    let simpleMode = false;
    let toHandlerName: string | undefined = undefined;

    function calculateAdaptiveCost(path: SerializableConvertPathNode[]): number {
        for (const deadEnd of temporaryDeadEnds) {
            let isDeadEnd = true;
            for (let i = 0; i < deadEnd.length; i++) {
                if (path[i]?.handlerName !== deadEnd[i]?.handlerName ||
                    path[i]?.format.mime !== deadEnd[i]?.format.mime ||
                    path[i]?.format.format !== deadEnd[i]?.format.format) {
                    isDeadEnd = false;
                    break;
                }
            }
            if (isDeadEnd) return Infinity;
        }
        let cost = 0;
        const categoriesInPath = path.map(p => p.format.category || p.format.mime.split("/")[0]);
        const matches = (formatCat: string | string[] | undefined, patternCat: string): boolean => {
            if (formatCat === undefined) return false;
            return Array.isArray(formatCat) ? formatCat.includes(patternCat) : formatCat === patternCat;
        };
        categoryAdaptiveCosts.forEach(c => {
            let pathPtr = categoriesInPath.length - 1, categoryPtr = c.categories.length - 1;
            while (true) {
                if (matches(categoriesInPath[pathPtr], c.categories[categoryPtr])) {
                    categoryPtr--;
                    pathPtr--;

                    if (categoryPtr < 0) {
                        cost += c.cost;
                        break;
                    }
                    if (pathPtr < 0) break;
                }
                else if (categoryPtr + 1 < c.categories.length && matches(categoriesInPath[pathPtr], c.categories[categoryPtr + 1])) {
                    pathPtr--;
                    if (pathPtr < 0) break;
                }
                else break;
            }
        });
        return cost;
    }

    function processSearch() {
        if (!queue) return;

        while (queue.size() > 0) {
            iterations++;
            if (iterations % 1000 === 0 && performance.now() - searchStartTime > SEARCH_TIMEOUT_MS) {
                console.warn(`Path search timed out after ${iterations} iterations. Queue size: ${queue.size()}, Paths found: ${pathsFound}`);
                postMessage({ type: 'done' });
                return;
            }

            let current = queue.poll()!;
            const best = bestCost.get(current.index);
            if (best !== undefined && current.cost > best) {
                continue;
            }

            if (current.index === toIndex) {
                const foundPathLast = current.path.at(-1);
                if (simpleMode || !toHandlerName || toHandlerName === foundPathLast?.handlerName) {
                    pathsFound++;
                    postMessage({ type: 'found', path: current.path });
                    // We pause the loop here to let the main thread process the found path
                    // Main thread will send a 'resume' message to continue
                    return;
                }
                continue;
            }

            bestCost.set(current.index, current.cost);


            if (iterations % 500 === 0) {
                postMessage({ type: 'searching', path: current.path });
            }

            nodes[current.index].edges.forEach(edgeIndex => {
                let edge = edges[edgeIndex];
                let path = current.path.concat({ handlerName: edge.handler, format: edge.to.format });
                const newAdaptiveCost = calculateAdaptiveCost(path);
                if (newAdaptiveCost === Infinity) return; // Dead-end path
                // Use max(0, delta) to avoid double-counting when the pattern continues to match,
                // while preserving previously-paid penalties when the pattern stops matching.
                const nextCost = current.cost + edge.cost + Math.max(0, newAdaptiveCost - current.adaptiveCost);

                // Don't prune paths to the destination, it's never settled (the
                // found-handler returns before settling) and we need multiple paths.
                if (edge.to.index !== toIndex) {
                    const existingBest = bestCost.get(edge.to.index);
                    if (existingBest !== undefined && nextCost >= existingBest) return;
                    bestCost.set(edge.to.index, nextCost);
                }

                queue!.add({
                    index: edge.to.index,
                    cost: nextCost,
                    path: path,
                    adaptiveCost: newAdaptiveCost
                });
            });

        }

        postMessage({ type: 'done' });
    }

    return function onmessage(e: MessageEvent) {
        const data = e.data;

        switch (data.type) {
            case 'init':
                nodes = data.nodes;
                edges = data.edges;
                categoryAdaptiveCosts = data.categoryAdaptiveCosts;
                break;

            case 'start':
                const { fromIdentifier, toIdentifier, isSimpleMode, targetHandlerName, initialDeadEnds, initialPath } = data;

                queue = new PriorityQueue<QueueNode>(1000, (a: QueueNode, b: QueueNode) => a.cost - b.cost);
                bestCost = new Map();
                temporaryDeadEnds = initialDeadEnds || [];
                iterations = 0;
                pathsFound = 0;
                searchStartTime = performance.now();
                simpleMode = isSimpleMode;
                toHandlerName = targetHandlerName;

                let fromIndex = nodes.findIndex(node => node.identifier === fromIdentifier);
                toIndex = nodes.findIndex(node => node.identifier === toIdentifier);

                if (fromIndex === -1 || toIndex === -1) {
                    postMessage({ type: 'done' });
                    return;
                }

                bestCost.set(fromIndex, 0);
                queue.add({ index: fromIndex, cost: 0, path: initialPath, adaptiveCost: 0 });

                processSearch();
                break;

            case 'resume':
                if (data.deadEnds) {
                    temporaryDeadEnds = data.deadEnds;
                }
                // Clear settled costs so nodes reached via now-dead-ended routes
                // can be re-explored through alternative paths remaining in the queue.
                bestCost = new Map();
                // Reset the timer for the new chunk. The main thread waits at most
                // ROUTE_SEARCH_TIMEOUT_MS (15s) per worker message, so each chunk
                // between yields gets a fresh budget rather than a cumulative one.
                searchStartTime = performance.now();
                processSearch();
                break;

            case 'stop':
                queue = null;
                break;
        }
    };
}

// In standard Web Worker environment, map to self.onmessage
if (typeof self !== 'undefined' && 'onmessage' in self) {
    self.onmessage = createWorkerHandler(self.postMessage.bind(self));
}
