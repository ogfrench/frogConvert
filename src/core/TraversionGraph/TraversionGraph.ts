import { ConvertPathNode, type FileFormat, type FormatHandler } from '../FormatHandler/FormatHandler.ts';

interface CategoryChangeCost {
    from: string;
    to: string;
    handler?: string; // Optional handler name to specify that this cost only applies when using a specific handler for the category change. If not specified, the cost applies to all handlers for that category change.
    cost: number;
};

interface CategoryAdaptiveCost {
    categories: string[]; // List of sequential categories
    cost: number; // Cost to apply when a conversion involves all of the specified categories in sequence.
}


// Parameters for pathfinding algorithm.
const DEPTH_COST: number = 1; // Base cost for each conversion step. Higher values will make the algorithm prefer shorter paths more strongly.
const DEFAULT_CATEGORY_CHANGE_COST: number = 0.6; // Default cost for category changes not specified in CATEGORY_CHANGE_COSTS
const LOSSY_COST_MULTIPLIER: number = 1.4; // Cost multiplier for lossy conversions. Higher values will make the algorithm prefer lossless conversions more strongly.
const HANDLER_PRIORITY_COST: number = 0.02; // Cost multiplier for handler priority. Higher values will make the algorithm prefer handlers with higher priority more strongly.
const FORMAT_PRIORITY_COST: number = 0.05; // Cost multiplier for format priority. Higher values will make the algorithm prefer formats with higher priority more strongly.


export interface Node {
    identifier: string;
    edges: Array<number>;
};

export interface Edge {
    from: { format: FileFormat, index: number };
    to: { format: FileFormat, index: number };
    handler: string;
    cost: number;
};

export class TraversionGraph {
    private handlersByName: Map<string, FormatHandler> = new Map();
    // Maps "from->to" category pair to the set of handler names that have a handler-specific cost for it.
    private handlerPairsCache: Map<string, Set<string>> = new Map();
    private nodes: Node[] = [];
    private edges: Edge[] = [];
    private categoryChangeCosts: CategoryChangeCost[] = [
        { from: "image", to: "video", cost: 0.2 }, // Almost lossless
        { from: "video", to: "image", cost: 0.4 }, // Potentially lossy and more complex
        { from: "image", to: "audio", handler: "ffmpeg", cost: 100 }, // FFMpeg can't convert images to audio
        { from: "audio", to: "image", handler: "ffmpeg", cost: 100 }, // FFMpeg can't convert audio to images
        { from: "text", to: "audio", handler: "ffmpeg", cost: 100 }, // FFMpeg can't convert text to audio
        { from: "audio", to: "text", handler: "ffmpeg", cost: 100 }, // FFMpeg can't convert audio to text
        { from: "image", to: "audio", cost: 1.4 }, // Extremely lossy
        { from: "audio", to: "image", cost: 1 }, // Very lossy
        { from: "video", to: "audio", cost: 1.4 }, // Might be lossy
        { from: "audio", to: "video", cost: 1 }, // Might be lossy
        { from: "text", to: "image", cost: 0.5 }, // Depends on the content and method, but can be relatively efficient for simple images
        { from: "image", to: "text", cost: 0.5 }, // Depends on the content and method, but can be relatively efficient for simple images
        { from: "text", to: "audio", cost: 0.6 }, // Somewhat lossy for anything that isn't speakable text
        { from: "document", to: "text", cost: 1 }, // Often very lossy, loses rich formatting
    ];
    private categoryAdaptiveCosts: CategoryAdaptiveCost[] = [
        { categories: ["text", "image", "audio"], cost: 15 }, // Text to audio through an image is likely not what the user wants
        { categories: ["image", "video", "audio"], cost: 10000 }, // Converting from image to audio through video is especially lossy
        { categories: ["audio", "video", "image"], cost: 10000 }, // Converting from audio to image through video is especially lossy
    ];
    // Keeps track of path segments that have failed when attempted during the last run
    private temporaryDeadEnds: ConvertPathNode[][] = [];
    private worker: Worker | null = null;


    public addCategoryChangeCost(from: string, to: string, cost: number, handler?: string, updateIfExists: boolean = true): boolean {
        if (this.hasCategoryChangeCost(from, to, handler)) {
            if (updateIfExists) {
                this.updateCategoryChangeCost(from, to, cost, handler)
                return true;
            }
            return false;
        }
        this.categoryChangeCosts.push({ from, to, cost, handler: handler?.toLowerCase() });
        return true;
    }
    public removeCategoryChangeCost(from: string, to: string, handler?: string): boolean {
        const initialLength = this.categoryChangeCosts.length;
        this.categoryChangeCosts = this.categoryChangeCosts.filter(c => !(c.from === from && c.to === to && c.handler === handler?.toLowerCase()));
        return this.categoryChangeCosts.length < initialLength;
    }
    public updateCategoryChangeCost(from: string, to: string, cost: number, handler?: string) {
        const costEntry = this.categoryChangeCosts.find(c => c.from === from && c.to === to && c.handler === handler?.toLowerCase());
        if (costEntry) costEntry.cost = cost;
        else this.addCategoryChangeCost(from, to, cost, handler);
    }
    public hasCategoryChangeCost(from: string, to: string, handler?: string) {
        return this.categoryChangeCosts.some(c => c.from === from && c.to === to && c.handler === handler?.toLowerCase());
    }


    public addCategoryAdaptiveCost(categories: string[], cost: number, updateIfExists: boolean = true): boolean {
        if (this.hasCategoryAdaptiveCost(categories)) {
            if (updateIfExists) {
                this.updateCategoryAdaptiveCost(categories, cost);
                return true;
            }
            return false;
        }
        this.categoryAdaptiveCosts.push({ categories, cost });
        return true;
    }
    public removeCategoryAdaptiveCost(categories: string[]): boolean {
        const initialLength = this.categoryAdaptiveCosts.length;
        this.categoryAdaptiveCosts = this.categoryAdaptiveCosts.filter(c => !(c.categories.length === categories.length && c.categories.every((cat, index) => cat === categories[index])));
        return this.categoryAdaptiveCosts.length < initialLength;
    }
    public updateCategoryAdaptiveCost(categories: string[], cost: number) {
        const costEntry = this.categoryAdaptiveCosts.find(c => c.categories.length === categories.length && c.categories.every((cat, index) => cat === categories[index]));
        if (costEntry) costEntry.cost = cost;
        else this.addCategoryAdaptiveCost(categories, cost);
    }
    public hasCategoryAdaptiveCost(categories: string[]) {
        return this.categoryAdaptiveCosts.some(c => c.categories.length === categories.length && c.categories.every((cat, index) => cat === categories[index]));
    }

    public get nodeCount(): number {
        return this.nodes.length;
    }

    public addDeadEndPath(pathFragment: ConvertPathNode[]) {
        this.temporaryDeadEnds.push(pathFragment);
    }
    public clearDeadEndPaths() {
        this.temporaryDeadEnds.length = 0;
    }

    /**
     * Initializes the traversion graph based on the supported formats and handlers. This should be called after all handlers have been registered and their supported formats have been cached in window.supportedFormatCache. The graph is built by creating nodes for each unique file format and edges for each possible conversion between formats based on the handlers' capabilities.
     * @param strictCategories If true, the algorithm will apply category change costs more strictly, even when formats share categories. This can lead to more accurate pathfinding at the cost of potentially longer paths and increased search time. If false, category change costs will only be applied when formats do not share any categories, allowing for more flexible pathfinding that may yield shorter paths but with less nuanced cost calculations.
     */
    public init(supportedFormatCache: Map<string, FileFormat[]>, handlers: FormatHandler[], strictCategories: boolean = false) {
        this.nodes.length = 0;
        this.edges.length = 0;

        // Pre-compute lookup maps for O(1) access in costFunction
        this.handlersByName.clear();
        for (const h of handlers) this.handlersByName.set(h.name, h);
        this.handlerPairsCache = new Map();
        for (const c of this.categoryChangeCosts) {
            if (!c.handler) continue;
            const key = `${c.from}->${c.to}`;
            const existing = this.handlerPairsCache.get(key);
            if (existing) existing.add(c.handler.toLowerCase());
            else this.handlerPairsCache.set(key, new Set([c.handler.toLowerCase()]));
        }

        console.log("Initializing traversion graph...");
        const startTime = performance.now();
        let handlerIndex = 0;
        supportedFormatCache.forEach((formats, handler) => {
            // Skip handlers that are in the cache but not registered in this graph instance.
            // This prevents phantom edges when a warm cache (e.g. from localStorage) includes
            // Phase 2 handlers that haven't been dynamically loaded yet during Phase 1.
            if (!this.handlersByName.has(handler)) return;

            let fromIndices: Array<{ format: FileFormat, index: number }> = [];
            let toIndices: Array<{ format: FileFormat, index: number }> = [];
            formats.forEach(format => {
                const formatIdentifier = format.mime + `(${format.format})`;
                let index = this.nodes.findIndex(node => node.identifier === formatIdentifier);
                if (index === -1) {
                    index = this.nodes.length;
                    this.nodes.push({
                        identifier: formatIdentifier,
                        edges: []
                    });
                }
                if (format.from) fromIndices.push({ format, index });
                if (format.to) toIndices.push({ format, index });
            });
            fromIndices.forEach(from => {
                toIndices.forEach(to => {
                    if (from.index === to.index) return; // No self-loops
                    this.edges.push({
                        from: from,
                        to: to,
                        handler: handler,
                        cost: this.costFunction(
                            from,
                            to,
                            strictCategories,
                            handler,
                            handlerIndex
                        )
                    });
                    this.nodes[from.index].edges.push(this.edges.length - 1);
                });
            });
            handlerIndex++;
        });
        const endTime = performance.now();
        console.log(`Traversion graph initialized in ${(endTime - startTime).toFixed(2)} ms with ${this.nodes.length} nodes and ${this.edges.length} edges.`);

        // Initialize Web Worker
        if (!this.worker) {
            this.worker = new Worker(new URL('../../workers/route-search.worker.ts', import.meta.url), { type: 'module' });
        }
        this.worker.postMessage({
            type: 'init',
            nodes: this.nodes,
            edges: this.edges,
            categoryAdaptiveCosts: this.categoryAdaptiveCosts
        });
    }
    /**
     * Cost function for calculating the cost of converting from one format to another using a specific handler.
     */
    private costFunction(
        from: { format: FileFormat; index: number; },
        to: { format: FileFormat; index: number; },
        strictCategories: boolean,
        handler: string,
        handlerIndex: number
    ) {
        let cost = DEPTH_COST; // Base cost for each conversion step

        // Calculate category change cost
        const fromCategory = from.format.category || from.format.mime.split("/")[0];
        const toCategory = to.format.category || to.format.mime.split("/")[0];
        if (fromCategory && toCategory) {
            const fromCategories = Array.isArray(fromCategory) ? fromCategory : [fromCategory];
            const toCategories = Array.isArray(toCategory) ? toCategory : [toCategory];
            if (strictCategories) {
                // Apply category change cost: use the matching entry's cost, or the default if none match.
                const matchingCosts = this.categoryChangeCosts.filter(c =>
                    fromCategories.includes(c.from)
                    && toCategories.includes(c.to)
                    && (!c.handler || c.handler === handler.toLowerCase())
                );
                if (matchingCosts.length === 0) {
                    cost += DEFAULT_CATEGORY_CHANGE_COST;
                } else {
                    cost += matchingCosts.reduce((sum, c) => sum + c.cost, 0);
                }
            }
            else if (!fromCategories.some(c => toCategories.includes(c))) {
                let costs = this.categoryChangeCosts.filter(c =>
                    fromCategories.includes(c.from)
                    && toCategories.includes(c.to)
                    && (
                        (!c.handler && !this.handlerPairsCache.get(`${c.from}->${c.to}`)?.has(handler.toLowerCase()))
                        || c.handler === handler.toLowerCase()
                    )
                );
                if (costs.length === 0) cost += DEFAULT_CATEGORY_CHANGE_COST; // If no specific cost is defined for this category change, use the default cost
                else cost += Math.min(...costs.map(c => c.cost)); // If multiple category changes are involved, use the lowest cost defined for those changes. This allows for more nuanced cost calculations when formats belong to multiple categories.
            }
        }
        else if (fromCategory || toCategory) {
            // If one format has a category and the other doesn't, consider it a category change
            // Should theoretically never be encountered, unless the MIME type is misspecified
            cost += DEFAULT_CATEGORY_CHANGE_COST;
        }

        // Add cost based on handler priority
        cost += HANDLER_PRIORITY_COST * handlerIndex;

        // Add cost based on format priority
        const handlerObj = this.handlersByName.get(handler);
        cost += FORMAT_PRIORITY_COST * (handlerObj?.supportedFormats?.findIndex(f => f.mime === to.format.mime) ?? 0);

        // Add cost multiplier for lossy conversions
        if (!to.format.lossless) cost *= LOSSY_COST_MULTIPLIER;

        return cost;
    }

    /**
     * Returns a copy of the graph data, including nodes, edges, category change costs, and category adaptive costs. This can be used for debugging, visualization, or analysis purposes. The returned data is a deep copy to prevent external modifications from affecting the internal state of the graph.
     */
    public getData(): { nodes: Node[], edges: Edge[], categoryChangeCosts: CategoryChangeCost[], categoryAdaptiveCosts: CategoryAdaptiveCost[] } {
        return {
            nodes: this.nodes.map(node => ({ identifier: node.identifier, edges: [...node.edges] })),
            edges: this.edges.map(edge => ({
                from: { format: { ...edge.from.format }, index: edge.from.index },
                to: { format: { ...edge.to.format }, index: edge.to.index },
                handler: edge.handler,
                cost: edge.cost
            })),
            categoryChangeCosts: this.categoryChangeCosts.map(c => ({ from: c.from, to: c.to, handler: c.handler, cost: c.cost })),
            categoryAdaptiveCosts: this.categoryAdaptiveCosts.map(c => ({ categories: [...c.categories], cost: c.cost }))
        };
    }
    /**
     * @coverageIgnore
     */
    public print() {
        let output = "Nodes:\n";
        this.nodes.forEach((node, index) => {
            output += `${index}: ${node.identifier}\n`;
        });
        output += "Edges:\n";
        this.edges.forEach((edge, index) => {
            output += `${index}: ${edge.from.format.mime} -> ${edge.to.format.mime} (handler: ${edge.handler}, cost: ${edge.cost})\n`;
        });
        console.log(output);
    }

    private listeners: Array<(state: string, path: ConvertPathNode[]) => void> = [];
    public addPathEventListener(listener: (state: string, path: ConvertPathNode[]) => void) {
        this.listeners.push(listener);
    }

    public removePathEventListener(listener: (state: string, path: ConvertPathNode[]) => void) {
        const index = this.listeners.indexOf(listener);
        if (index !== -1) this.listeners.splice(index, 1);
    }

    private dispatchEvent(state: string, path: ConvertPathNode[]) {
        this.listeners.forEach(l => l(state, path));
    }

    public async* searchPath(from: ConvertPathNode, to: ConvertPathNode, simpleMode: boolean): AsyncGenerator<ConvertPathNode[]> {
        if (!this.worker) {
            console.error("Worker not initialized!");
            return;
        }

        const fromIdentifier = from.format.mime + `(${from.format.format})`;
        const toIdentifier = to.format.mime + `(${to.format.format})`;

        let fromIndex = this.nodes.findIndex(node => node.identifier === fromIdentifier);
        let toIndex = this.nodes.findIndex(node => node.identifier === toIdentifier);

        if (fromIndex === -1 || toIndex === -1) return;

        // Convert path to serializable format
        const initialPath = [{ handlerName: from.handler.name, format: from.format }];
        const initialDeadEnds = this.temporaryDeadEnds.map(d =>
            d.map(n => ({ handlerName: n.handler.name, format: n.format }))
        );

        let workerMessageQueue: any[] = [];
        let workerMessageResolver: ((msg: any) => void) | null = null;

        const messageListener = (e: MessageEvent) => {
            if (workerMessageResolver) {
                workerMessageResolver(e.data);
                workerMessageResolver = null;
            } else {
                workerMessageQueue.push(e.data);
            }
        };
        this.worker.addEventListener('message', messageListener);

        this.worker.postMessage({
            type: 'start',
            fromIdentifier,
            toIdentifier,
            isSimpleMode: simpleMode,
            targetHandlerName: to.handler?.name,
            initialDeadEnds,
            initialPath
        });

        const deserializePath = (serializablePath: any[]): ConvertPathNode[] => {
            return serializablePath.map(p => {
                const handler = this.handlersByName.get(p.handlerName)!;
                return { handler, format: p.format };
            });
        };

        try {
            let processedMessages = 0;
            while (true) {
                let message;
                if (workerMessageQueue.length > 0) {
                    message = workerMessageQueue.shift();
                    // Yield occasionally to ensure UI responsiveness when flushing large backlog
                    if (++processedMessages % 100 === 0) {
                        await new Promise(r => setTimeout(r, 0));
                    }
                } else {
                    // Let the browser paint before actively awaiting the next message
                    // Without this macro-task yield, microtask (Promise) queues might starve the render thread
                    // if the worker resolves extremely quickly in bursts.
                    // Note: In Vitest (Node.js), setTimeout can break the mock worker's synchronous flow, so we skip it if we detect a mock worker.
                    if (!(this.worker as any).__isMockWorker) {
                        await new Promise(r => setTimeout(r, 0));
                    }
                    message = await new Promise<any>((resolve) => {
                        workerMessageResolver = resolve;
                    });
                }

                if (message.type === 'done') {
                    break;
                } else if (message.type === 'found') {
                    const path = deserializePath(message.path);
                    this.dispatchEvent("found", path);

                    yield path; // Yield to caller

                    // Caller requested the next path, resume worker with latest dead ends
                    const currentDeadEnds = this.temporaryDeadEnds.map(d =>
                        d.map(n => ({ handlerName: n.handler.name, format: n.format }))
                    );
                    this.worker!.postMessage({ type: 'resume', deadEnds: currentDeadEnds });
                } else if (message.type === 'searching') {
                    this.dispatchEvent("searching", deserializePath(message.path));
                } else if (message.type === 'skipped') {
                    this.dispatchEvent("skipped", deserializePath(message.path));
                }
            }
        } finally {
            this.worker.removeEventListener('message', messageListener);
            this.worker.postMessage({ type: 'stop' });
        }
    }
}