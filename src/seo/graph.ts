// ---------------------------------------------------------------------------
// Read-only view of the conversion route graph, for build-time page generation
// ---------------------------------------------------------------------------
// Landing pages may only claim conversions the app can actually perform, so
// this module is the gate: it loads the committed format registry and answers
// "is this route real, and what runs it".
//
// Why not import TraversionGraph directly: its `init()` ends by constructing a
// Worker, and it needs live FormatHandler instances, which pull in WASM and
// browser globals. What we need here is reachability, not routing, and that is
// a plain BFS over the same edge set.
//
// The edge rule below mirrors TraversionGraph.init(): for each handler, every
// format it can read connects to every format it can write. The real graph
// additionally adds `supportAnyInput` edges, so this view is *conservative* -
// it can call a route unreachable that the app would in fact chain. That is
// the safe direction to be wrong in: we omit a page rather than publish one
// promising a conversion that fails.

export interface FormatRecord {
  name: string;
  format: string;
  extension: string;
  mime: string;
  category?: string | string[];
  internal: string;
  from: boolean;
  to: boolean;
  lossless?: boolean;
}

/** Shape of public/cache.json: a Map<handlerName, FileFormat[]> dumped to JSON. */
export type FormatCache = Array<[string, FormatRecord[]]>;

export interface FormatInfo {
  /** Canonical lowercase token, normally the file extension (e.g. "jpg"). */
  token: string;
  /** Longest human-readable name seen for this format across handlers. */
  displayName: string;
  extensions: string[];
  mimes: string[];
  categories: string[];
  /** Handler names that can read / write it. These are the engines we name. */
  readableBy: string[];
  writableBy: string[];
}

export interface Route {
  from: string;
  to: string;
  /** 1 = a single handler does it end to end; >1 = the app chains handlers. */
  hops: number;
  /** Handlers that perform it in one step. Empty when hops > 1. */
  engines: string[];
}

const nodeId = (f: FormatRecord): string => `${f.mime}(${f.format})`;

/** A format record's tokens: its extension and its short format name. */
function tokensOf(f: FormatRecord): string[] {
  const out = new Set<string>();
  for (const raw of [f.extension, f.format]) {
    if (typeof raw === "string" && raw.trim()) out.add(raw.trim().toLowerCase());
  }
  return [...out];
}

function categoriesOf(f: FormatRecord): string[] {
  const c = f.category;
  if (Array.isArray(c)) return c.filter(Boolean);
  return typeof c === "string" && c ? [c] : [];
}

export class FormatGraph {
  private readonly adjacency = new Map<string, Set<string>>();
  /** token -> node ids that can be read from */
  private readonly readNodes = new Map<string, Set<string>>();
  /** token -> node ids that can be written to */
  private readonly writeNodes = new Map<string, Set<string>>();
  private readonly infos = new Map<string, FormatInfo>();
  /**
   * Handler name -> its index in the cache, which is the order handlers were
   * registered. TraversionGraph.costFunction() adds HANDLER_PRIORITY_COST per
   * index, so a lower index is what the app actually reaches for. We rank the
   * same way rather than inventing our own preference: naming "meyda" as the
   * engine for png->jpg would be true of the graph and wrong about the app.
   */
  private readonly handlerRank = new Map<string, number>();

  private constructor(cache: FormatCache) {
    cache.forEach(([handler], index) => {
      if (!this.handlerRank.has(handler)) this.handlerRank.set(handler, index);
    });

    for (const [handler, formats] of cache) {
      const readable = formats.filter(f => f.from);
      const writable = formats.filter(f => f.to);

      for (const f of formats) {
        const id = nodeId(f);
        for (const token of tokensOf(f)) {
          this.mergeInfo(token, f, handler);
          if (f.from) addTo(this.readNodes, token, id);
          if (f.to) addTo(this.writeNodes, token, id);
        }
      }

      for (const a of readable) {
        const ia = nodeId(a);
        for (const b of writable) {
          const ib = nodeId(b);
          if (ia !== ib) addTo(this.adjacency, ia, ib);
        }
      }
    }
  }

  static fromCache(cache: FormatCache): FormatGraph {
    return new FormatGraph(cache);
  }

  private mergeInfo(token: string, f: FormatRecord, handler: string): void {
    let info = this.infos.get(token);
    if (!info) {
      info = {
        token,
        displayName: f.name || token.toUpperCase(),
        extensions: [],
        mimes: [],
        categories: [],
        readableBy: [],
        writableBy: [],
      };
      this.infos.set(token, info);
    }
    // Handler-supplied names vary in quality (ImageMagick's enumeration is
    // often mislabelled). The longest is a decent proxy for the most specific.
    if (f.name && f.name.length > info.displayName.length) info.displayName = f.name;
    pushUnique(info.extensions, f.extension?.toLowerCase());
    pushUnique(info.mimes, f.mime);
    for (const c of categoriesOf(f)) pushUnique(info.categories, c);
    if (f.from) pushUnique(info.readableBy, handler);
    if (f.to) pushUnique(info.writableBy, handler);
  }

  format(token: string): FormatInfo | undefined {
    return this.infos.get(token.toLowerCase());
  }

  formats(): FormatInfo[] {
    return [...this.infos.values()];
  }

  canRead(token: string): boolean {
    return (this.readNodes.get(token.toLowerCase())?.size ?? 0) > 0;
  }

  canWrite(token: string): boolean {
    return (this.writeNodes.get(token.toLowerCase())?.size ?? 0) > 0;
  }

  /**
   * Handlers that convert `from` to `to` in a single step, best first.
   * "Best" is the app's own ordering (see handlerRank), so the engine we name
   * on a page is the one that would actually run.
   */
  directEngines(from: string, to: string): string[] {
    const a = this.format(from);
    const b = this.format(to);
    if (!a || !b) return [];
    return a.readableBy
      .filter(h => b.writableBy.includes(h))
      .sort((x, y) => this.rank(x) - this.rank(y));
  }

  private rank(handler: string): number {
    return this.handlerRank.get(handler) ?? Number.MAX_SAFE_INTEGER;
  }

  /**
   * Shortest hop count from `from` to `to`, or null when unreachable within
   * `maxHops`. The cap matters: the graph is close to fully connected at
   * depth 5+, and a route that long is not one we want to advertise.
   */
  route(from: string, to: string, maxHops = 4): Route | null {
    const src = this.readNodes.get(from.toLowerCase());
    const dst = this.writeNodes.get(to.toLowerCase());
    if (!src?.size || !dst?.size) return null;

    const engines = this.directEngines(from, to);
    if (engines.length) return { from, to, hops: 1, engines };

    const seen = new Set(src);
    let frontier = new Set(src);
    for (let depth = 1; depth <= maxHops; depth++) {
      const next = new Set<string>();
      for (const n of frontier) {
        for (const m of this.adjacency.get(n) ?? []) {
          if (!seen.has(m)) next.add(m);
        }
      }
      for (const n of next) {
        if (dst.has(n)) return { from, to, hops: depth, engines: [] };
      }
      for (const n of next) seen.add(n);
      frontier = next;
      if (!frontier.size) break;
    }
    return null;
  }
}

function addTo<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.add(value);
  else map.set(key, new Set([value]));
}

function pushUnique(arr: string[], value: string | undefined): void {
  if (value && !arr.includes(value)) arr.push(value);
}
