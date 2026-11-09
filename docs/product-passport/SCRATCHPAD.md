# Product Passport: frogConvert pilot scratchpad

Updated: 2026-11-09. Code is the source, documentation is a navigation index.

## Completed in `feat/product-passport-pdf-merge-2026-11-09`

- [x] Inspect existing PDF merge engine, REST, MCP, unit tests, corpus tests, and repository rules.
- [x] Add a native `package.json` script that runs the existing engine, MCP and REST assertions without another test framework.
- [x] Add a small source-path index and project-owned verification skill that calls executable tests rather than treating documentation as a contract.

## CI evidence

- [x] Draft PR [#129](https://github.com/ogfrench/frogConvert/pull/129) opened, not merged.
- [x] `verify`, `nginx`, `xlsx-provenance`, plugin `validate` and `native-linux-probe` jobs passed at source SHA `e892291fc03f3f2355106026843c210fc3863a58` (runs [42589674132](https://github.com/ogfrench/frogConvert/actions/runs/42589674132) and [42589674183](https://github.com/ogfrench/frogConvert/actions/runs/42589674183)). The separate build job was still in progress when reviewed.

## Executed on 2026-11-09 (Linux, bun 1.4.4, base `bf63d60`)

- Runtime-verified: `bun run verify:pdf-merge` passes, 3 files and 39 tests, on the unmodified branch.
- Planted defects, each applied alone to `src/tools/pdfMerge.ts` and reverted. The focused command caught dropping the last input file (4 failures) and dropping the last page of every file (5 failures). It did **not** catch reversed page order within a file or reversed file order: all 39 tests passed.
- Cause: "preserves page order across files" asserted only the page count of blank pages, and the MCP and REST tests assert counts too. The unit test now uses pages of distinct widths and asserts the merged width sequence. With it, both previously missed defects fail that test, the dropped-file defect still fails, and the real code passes 39 of 39.
- Not verified: `bun run test:corpus` skipped all 49 tests because `test/corpus` is not in the repo. No real-file page-order acceptance has run.

## Pending proof

- [ ] Real corpus tests, needs the corpus fixtures. A skipped run is not a pass.
- [ ] Full CI at the final PR head, including the `build` job.
- [ ] Independent review of unsafe file paths, output integrity and coverage gaps. The MCP and REST tests still assert page counts only, not order.
- [ ] Actual browser PDF merge journey and clean-host acceptance if distribution scope expands.
- [ ] Merge or release. No release authorized.

## Next

Reconfirm full CI, execute `bun run verify:pdf-merge` explicitly on the exact branch if not covered by the workflow, and inspect real corpus files where authorized. Evaluate whether the shortcut improves verification before widening coverage. Do not expand the feature inventory merely to increase documentation coverage.
