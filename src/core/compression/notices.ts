import type { FileData, Notice } from "../FormatHandler/FormatHandler.ts";

/**
 * Push a structured notice onto a FileData. Also mirrors the body onto
 * the legacy `warnings` string array so MCP/API consumers that still
 * read the JSON `warnings` field see it.
 */
export function attachNotice(file: FileData, notice: Notice): void {
  (file.notices ??= []).push(notice);
  (file.warnings ??= []).push(notice.body);
}

/**
 * Canonical API-docs link for the "escape hatch" action on notices that
 * have a programmatic equivalent.
 */
export const API_DOCS_ACTION = { label: "API docs", href: "/docs/integrations/" };

/** Format a duration in seconds as "Xm Ys" or "Ys". */
export function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "unknown";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}
