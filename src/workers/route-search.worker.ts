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
    visitedBorder: number;
}

export function createWorkerHandler(postMessage: (msg: any) => void) {
    // Global state for this worker instance
    let nodes: Node[] = [];
    let edges: Edge[] = [];
    let categoryAdaptiveCosts: CategoryAdaptiveCost[] = [];

    // Search state
    const MAX_ITERATIONS = 50000;

    let queue: PriorityQueue<QueueNode> | null = null;
    let minCosts = new Map<number, number>();
    let temporaryDeadEnds: SerializableConvertPathNode[][] = [];
    let iterations = 0;
    let pathsFound = 0;

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
        categoryAdaptiveCosts.forEach(c => {
            let pathPtr = categoriesInPath.length - 1, categoryPtr = c.categories.length - 1;
            while (true) {
                if (categoriesInPath[pathPtr] === c.categories[categoryPtr]) {
                    categoryPtr--;
                    pathPtr--;

                    if (categoryPtr < 0) {
                        cost += c.cost;
                        break;
                    }
                    if (pathPtr < 0) break;
                }
                else if (categoryPtr + 1 < c.categories.length && categoriesInPath[pathPtr] === c.categories[categoryPtr + 1]) {
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
            if (iterations > MAX_ITERATIONS) {
                console.warn(`Path search aborted after ${MAX_ITERATIONS} iterations. Queue size: ${queue.size()}, Paths found: ${pathsFound}`);
                postMessage({ type: 'done' });
                return;
            }

            let current = queue.poll()!;
            const recordedCost = minCosts.get(current.index);

            if (recordedCost !== undefined && recordedCost < current.cost) {
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

            if (recordedCost === undefined || current.cost < recordedCost) {
                minCosts.set(current.index, current.cost);
            }

            if (iterations % 500 === 0) {
                postMessage({ type: 'searching', path: current.path });
            }

            nodes[current.index].edges.forEach(edgeIndex => {
                let edge = edges[edgeIndex];

                let path = current.path.concat({ handlerName: edge.handler, format: edge.to.format });
                const nextCost = current.cost + edge.cost + calculateAdaptiveCost(path);
                if (nextCost === Infinity) return;

                const neighborCost = minCosts.get(edge.to.index);
                if (neighborCost !== undefined && neighborCost < nextCost) return;

                queue!.add({
                    index: edge.to.index,
                    cost: nextCost,
                    path: path,
                    visitedBorder: 0
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
                minCosts.clear();
                temporaryDeadEnds = initialDeadEnds || [];
                iterations = 0;
                pathsFound = 0;
                simpleMode = isSimpleMode;
                toHandlerName = targetHandlerName;

                let fromIndex = nodes.findIndex(node => node.identifier === fromIdentifier);
                toIndex = nodes.findIndex(node => node.identifier === toIdentifier);

                if (fromIndex === -1 || toIndex === -1) {
                    postMessage({ type: 'done' });
                    return;
                }

                queue.add({ index: fromIndex, cost: 0, path: initialPath, visitedBorder: 0 });

                processSearch();
                break;

            case 'resume':
                if (data.deadEnds) {
                    temporaryDeadEnds = data.deadEnds;
                }
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
