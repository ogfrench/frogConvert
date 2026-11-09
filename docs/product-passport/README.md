# Product Passport: frogConvert source map

**Source of truth:** the executable TypeScript under `src/`, the actual build and the output files. This page is a pointer to source and tests, not a specification. If it disagrees with implementation, investigate the code and tests before changing this index.

## PDF merge pilot

| Ownership | Actual source |
|---|---|
| PDF merge engine | `src/tools/pdfMerge.ts` |
| MCP interface | `src/mcp/tools/pdfMerge.ts` |
| REST interface | `src/api/routes/pdf.ts` |
| Browser workspace | `src/components/PdfWorkspace/PdfWorkspace.ts` |
| Engine assertions | `src/tools/pdfMerge.test.ts` |
| MCP assertions | `src/mcp/tools/pdfMerge.test.ts` |
| REST assertions | `src/api/routes/pdf.route.test.ts` |
| Real corpus MCP checks | `test/e2e/corpus-mcp.test.ts` |

The `package.json` script `verify:pdf-merge` is the source-backed entry point for focused tests:

```sh
bun run verify:pdf-merge
```

When the real optional corpus is present, `bun run test:corpus` adds actual file-content and page-order acceptance. A skipped test or unavailable corpus is not a pass. The focused command cannot prove a real browser UI experience, complete security boundary, or packaged-host install. Use the existing UI/host tests when those surfaces change.

PDF merge operates on PDF structure, not the format conversion graph. Follow code boundaries, inspect produced PDF bytes, retain originals, and verify failure conditions. Existing `AGENTS.md`, security tests, and release gates still apply.

Progress and outstanding checks are recorded in [SCRATCHPAD.md](SCRATCHPAD.md).
