import { compressViaBrowser } from "../mcp/core/browserBridge.ts";
import type { AgentCompressInput, AgentCompressResult } from "../core/compression/compressForAgents.ts";
import type { QualityPreset } from "../core/FormatHandler/FormatHandler.ts";

/**
 * `compressForAgents`'s browser fallback, wired to the bridge.
 *
 * Lives here rather than in `core/` so the compression module stays free of
 * Puppeteer and the browser bundle never pulls any of this in.
 */
export async function compressInBrowser(
    input: AgentCompressInput,
    level: QualityPreset | "auto",
): Promise<AgentCompressResult> {
    const out = await compressViaBrowser(
        input.name,
        Buffer.from(input.bytes).toString("base64"),
        input.mime,
        input.extension,
        level,
    );
    return {
        name: out.fileName,
        bytes: new Uint8Array(Buffer.from(out.base64Bytes, "base64")),
        originalSize: out.originalSize,
        shrunk: out.shrunk,
        reason: out.reason,
        warning: out.warning,
    };
}
