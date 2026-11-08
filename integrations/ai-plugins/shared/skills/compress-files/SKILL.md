---
name: compress-files
description: Reduce the file size of local images, audio, video, and PDFs with frogConvert while keeping the format.
---

Use `compress_file` when a user wants a smaller file without changing its extension. Same-format `convert_file` is not compression.

Select `level` from the request; otherwise use `auto`. For batches, use `filePaths` when available. Prefer paths to embedding file bytes in conversation. Preserve originals and write separate outputs. Report sizes and warnings only when returned by the tool. Some PDFs cannot shrink meaningfully and should remain unchanged. Never promise a specific compression ratio.

If the MCP tools are unavailable, do not claim compression succeeded. Inform the user of the local desktop requirement.
