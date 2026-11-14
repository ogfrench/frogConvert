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

---

## Additional capability map (reviewed 14 November 2026)

The PDF-merge pilot above remains valid as a navigation aid. The other executable subsystems have distinct ownership and verification needs.

| User outcome | Canonical implementation | Focused proof |
| --- | --- | --- |
| Convert between formats | `src/core/TraversionGraph/`, `src/handlers/`, `src/conversion/` | Conversion route/handler tests plus real input→output byte/decoder inspection; negative unsupported/unreachable conversion |
| Compress without format change | `src/core/compression/compressBatch.ts`, `resolveCompressor.ts`, `automatic.ts` | `src/core/compression/compressBatch.test.ts`, `resolveCompressor.test.ts`; test mixed batches, thresholds, failed handler and input preservation |
| Expose local MCP and REST file tooling | `src/mcp/tools/convertFile.ts`, `src/mcp/core/fileInput.ts`, `src/api/routes/` | MCP and REST tests; invalid path/symlink/sandbox escape and errors on file writes. The MCP conversion tool calls `enforceSandboxedPath` before writing output |
| Use browser Office conversion engine | `src/core/officeEngine/`, `src/conversion/officeRoute.ts`, `src/handlers/libreoffice.ts` | Targeted Office tests, actual representative Word/Excel/PowerPoint file fidelity in isolated browser, `.github/workflows/office-engine.yml` |
| Install/use AI plugins | `integrations/ai-plugins/`, `scripts/build-ai-plugins.py`, `tests/test_ai_plugins.py` | Reproducible artifact/manifest integrity and actual host/tool activation; `.github/workflows/ai-plugins.yml` is candidate validation, not acceptance |

### Engineering workflow and failure-proofing

1. Choose the correct owner first: format-to-format graph, structure-level PDF editing, or same-format compression. Compression groups mixed files by handler and reads bytes **per file**; don't regress to loading the entire batch into memory or represent compression as a zero-hop conversion.
2. Use `bun run test` for source changes and `bun run verify:pdf-merge` for that contract. Run a relevant `test/e2e/` case and inspect resulting file content for browser, binary, font or format fidelity. Optional corpus suites that skip when fixtures are missing count as **not_run** for corpus acceptance.
3. Cover a valid input and an invalid/hostile input at the changed trust boundary: corrupt bytes, unsupported format, output overwrite, sandbox escape or failed worker. Keep browser files local and user-owned.
4. `ci.yml` validates source, `office-engine.yml` checks a selective costly browser path, while `docker.yml` and `electron.yml` publish products on their own events. Preserve image and release publishing; do not assume a PR green check is deployment or distribution proof.
5. Reconcile exact SHA, Bun version, file fixtures, result hashes, test artifacts and **passed / failed / blocked / not_run** in the PR. For generated installers, check the real host separately.

**This review:** source/test/workflow inspected; no test, real conversion, packaged-host or release execution occurred.
