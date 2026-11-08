---
name: convert-files
description: Convert local documents, images, media, and data files into another format with frogConvert.
---

Use this skill when the user wants a different file format. Find the input and requested output format before invoking frogConvert.

1. Prefer local file paths with `convert_file` rather than base64 for large files. Use `list_formats` or `find_conversion_path` if support is uncertain.
2. Preserve the original. Write to a distinct output file and never silently overwrite it.
3. Default to `quality: "lossless"` unless the user explicitly requests smaller or lower-quality output.
4. If a conversion reports warnings, disclose them. Do not claim a file converted when the tool failed.
5. If this environment does not expose the frogConvert MCP tools, explain that local MCP is unavailable here; do not pretend that plugin instructions can perform a conversion.

Local conversion is not the same as model-side privacy: file content, paths, or metadata passed to the AI client may be processed by its provider.
