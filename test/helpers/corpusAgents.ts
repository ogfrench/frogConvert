import { spawn, type ChildProcess } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";

/**
 * Shared plumbing for driving the two agent surfaces - the local REST API and
 * the MCP server - against the real corpus.
 *
 * The sibling of `corpusBrowser.ts`, and for the same reason: the checks worth
 * having are the ones that run a real file through a real process, and two
 * suites should not each carry a copy of the machinery that makes that
 * possible.
 *
 * What these surfaces have that the browser does not, and therefore what is
 * only reachable from here: reading bytes off disk, base64 in both directions,
 * writing results back to a path, and a server process launching Chromium to
 * service a request it could not answer natively.
 */

const ROOT = path.resolve(__dirname, "../../");

/** Keep the tail of a child's stderr, so a failure can say what it said. */
class TailLog {
    private lines: string[] = [];
    constructor(private readonly max = 60) {}
    push(chunk: string) {
        for (const line of chunk.split("\n")) {
            if (!line.trim()) continue;
            this.lines.push(line);
            if (this.lines.length > this.max) this.lines.shift();
        }
    }
    toString() { return this.lines.join("\n"); }
}

/** Stop a child and do not return until it is actually gone. */
async function stopChild(proc: ChildProcess, graceMs = 10_000): Promise<void> {
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    // SIGTERM rather than SIGKILL: browserBridge.ts installs a SIGTERM handler
    // that exits cleanly, and its exit handler is what kills the Chromium it
    // warmed up. SIGKILL here would leak a browser per suite run.
    proc.kill("SIGTERM");
    await new Promise<void>(resolve => {
        const timer = setTimeout(() => { proc.kill("SIGKILL"); resolve(); }, graceMs);
        proc.once("exit", () => { clearTimeout(timer); resolve(); });
    });
}

// --- REST -----------------------------------------------------------------

export interface ApiServer {
    /** e.g. `http://127.0.0.1:41231` */
    base: string;
    port: number;
    stderr: () => string;
    close: () => Promise<void>;
}

/**
 * Boot `bun src/api/index.ts` on an ephemeral port and wait until it serves.
 *
 * `PORT=0` is not decoration. The server defaults to 3000 and vitest runs test
 * files in parallel workers, so a suite that assumed the default would collide
 * with anything else listening - including a second copy of itself - and fail
 * as EADDRINUSE inside a child process, which surfaces as an unexplained
 * connection refusal in the test rather than as a port conflict.
 *
 * The assigned port is read back off the line the server prints, because
 * that is the only place it exists: `Bun.serve` picks it, and nothing outside
 * the process is told what it picked.
 *
 * Waiting for that line also doubles as the readiness check. `main()` awaits
 * the full handler registry before it calls `Bun.serve`, so the line cannot
 * appear until the engines are loaded.
 */
export async function startApi(timeoutMs = 300_000): Promise<ApiServer> {
    const log = new TailLog();
    const proc = spawn("bun", ["src/api/index.ts"], {
        cwd: ROOT,
        env: { ...process.env, PORT: "0" },
        stdio: ["ignore", "pipe", "pipe"],
    });

    let resolvePort: (base: string) => void;
    let rejectPort: (err: Error) => void;
    const listening = new Promise<string>((res, rej) => { resolvePort = res; rejectPort = rej; });

    let found = false;
    const onStderr = (buf: Buffer) => {
        const text = buf.toString();
        log.push(text);
        if (found) return;
        const m = text.match(/running at (http:\/\/127\.0\.0\.1:(\d+))/);
        if (m) { found = true; resolvePort(m[1]); }
    };
    proc.stderr?.on("data", onStderr);
    // Drained but discarded: an unread pipe fills and blocks the child.
    proc.stdout?.on("data", () => { /* the API talks on stderr */ });

    proc.once("exit", (code, signal) => {
        if (!found) {
            rejectPort(new Error(
                `API server exited before it listened (code=${code} signal=${signal})\n${log}`));
        }
    });

    const timer = setTimeout(() => {
        if (!found) rejectPort(new Error(`API server did not listen within ${timeoutMs} ms\n${log}`));
    }, timeoutMs);

    let base: string;
    try {
        base = await listening;
    } catch (err) {
        clearTimeout(timer);
        await stopChild(proc);
        throw err;
    }
    clearTimeout(timer);

    // The port line is printed from inside the `Bun.serve` call, so trust it
    // but confirm it: a health check costs nothing and turns "the socket is
    // not there yet" into a clear failure instead of a flaky first request.
    const health = await fetch(`${base}/health`);
    if (!health.ok) {
        await stopChild(proc);
        throw new Error(`API server answered /health with ${health.status}\n${log}`);
    }

    return {
        base,
        port: Number(base.split(":").pop()),
        stderr: () => log.toString(),
        close: () => stopChild(proc),
    };
}

/** `POST <route>` with a JSON body, returning the status and parsed body. */
export async function postJson(
    base: string, route: string, body: unknown,
): Promise<{ status: number; body: any }> {
    const res = await fetch(`${base}${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
}

export interface MultipartResult {
    status: number;
    /** The response body, weighed rather than described. */
    bytes: Uint8Array;
    headers: Headers;
    /** `X-Compress-Report`, parsed, when the route sent one. */
    report: any | null;
}

/**
 * `POST <route>` with a real file as multipart, returning the raw bytes.
 *
 * The bytes matter more than the report here. The whole class of defect this
 * suite exists to catch is a response that describes itself correctly and
 * carries the wrong payload - or no payload.
 */
export async function postFile(
    base: string, route: string, filePath: string, fields: Record<string, string> = {},
    fileName = path.basename(filePath),
): Promise<MultipartResult> {
    const form = new FormData();
    form.append("file", new File([fs.readFileSync(filePath)], fileName));
    for (const [k, v] of Object.entries(fields)) form.append(k, v);

    const res = await fetch(`${base}${route}`, { method: "POST", body: form });
    const bytes = new Uint8Array(await res.arrayBuffer());
    const raw = res.headers.get("X-Compress-Report");
    return { status: res.status, bytes, headers: res.headers, report: raw ? JSON.parse(raw) : null };
}

// --- MCP ------------------------------------------------------------------

export interface McpSession {
    client: Client;
    close: () => Promise<void>;
}

/**
 * Connect to `bun src/mcp/index.ts` over a real stdio transport.
 *
 * The same shape `src/mcp/index.integration.test.ts` uses. Unlike the API the
 * MCP server connects its transport before the registry finishes loading -
 * deliberately, because Pandoc's WASM can take minutes to compile and a client
 * would time out waiting - so a successful handshake is not a promise that the
 * first tool call will be quick. Callers should budget accordingly.
 */
export async function startMcp(): Promise<McpSession> {
    const transport = new StdioClientTransport({
        command: "bun",
        args: ["src/mcp/index.ts"],
        cwd: ROOT,
        env: { ...process.env } as Record<string, string>,
    });

    const client = new Client({ name: "corpus-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);

    return {
        client,
        close: async () => { try { await client.close(); } catch { /* already gone */ } },
    };
}

/**
 * Call a tool and return its payload parsed.
 *
 * Every tool in this server answers with a single JSON text block, and an
 * `isError` reply carries a bare message rather than JSON - so a caller that
 * blindly parses gets a JSON syntax error in place of the actual complaint.
 * Surface the complaint instead.
 */
export async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<any> {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as { text?: string }[] | undefined)
        ?.map(c => c.text ?? "").join("") ?? "";
    if (res.isError) throw new Error(`${name} failed: ${text}`);
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`${name} did not return JSON: ${text.slice(0, 400)}`);
    }
}

// --- shared assertions ----------------------------------------------------

/**
 * What a file claims to be from its first few bytes.
 *
 * An output is only proof of anything if something other than the producer
 * agrees about what it is. This is the cheap half of that; re-opening it in
 * pdf-lib or pdfjs (see `corpusBrowser.ts`) is the thorough half.
 */
export function sniff(bytes: Uint8Array): string {
    const b = bytes;
    const starts = (...sig: number[]) => sig.every((v, i) => b[i] === v);
    if (starts(0x25, 0x50, 0x44, 0x46)) return "pdf";      // %PDF
    if (starts(0xff, 0xd8, 0xff)) return "jpeg";
    if (starts(0x89, 0x50, 0x4e, 0x47)) return "png";
    if (starts(0x50, 0x4b, 0x03, 0x04)) return "zip";
    if (starts(0x25, 0x21)) return "ps";                    // %!
    if (starts(0x1a, 0x45, 0xdf, 0xa3)) return "matroska";  // webm/mkv
    if (starts(0x49, 0x44, 0x33)) return "mp3";             // ID3
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "isobmff"; // mp4/mov
    if (starts(0x52, 0x49, 0x46, 0x46)) return "riff";      // wav/webp container
    return `unknown(${[...b.slice(0, 4)].map(x => x.toString(16).padStart(2, "0")).join(" ")})`;
}

/** Decode a base64 payload the agent surfaces hand back. */
export function fromB64(b64: string): Uint8Array {
    return new Uint8Array(Buffer.from(b64, "base64"));
}

export function toB64(bytes: Uint8Array | Buffer): string {
    return Buffer.from(bytes).toString("base64");
}
