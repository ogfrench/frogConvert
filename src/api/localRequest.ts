/** Keep browser-originated requests from other sites away from the local file API.
 * Requests without Origin remain usable by CLI/MCP clients; browser Fetch
 * Metadata, when present, independently rejects cross-site navigation/fetches.
 */
export function localRequestAllowed(origin: string | null, host: string, fetchSite: string | null): boolean {
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)) return false;
    if (fetchSite === "cross-site" || fetchSite === "same-site") return false;
    // "null" is sent by sandboxed iframes and file:// origins. It is not a trusted CLI.
    if (origin === "null") return false;
    if (origin === null) return true;
    return origin === `http://${host}` || origin === `https://${host}`;
}
