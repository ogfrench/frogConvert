# Product Passport: frogConvert pilot scratchpad

Updated: 2026-11-09. Code is the source, documentation is a navigation index.

## Completed in `feat/product-passport-pdf-merge-2026-11-09`

- [x] Inspect existing PDF merge engine, REST, MCP, unit tests, corpus tests, and repository rules.
- [x] Add a native `package.json` script that runs the existing engine, MCP and REST assertions without another test framework.
- [x] Add a small source-path index and project-owned verification skill that calls executable tests rather than treating documentation as a contract.

## CI evidence

- [x] Draft PR [#129](https://github.com/ogfrench/frogConvert/pull/129) opened, not merged.
- [x] `verify`, `nginx`, `xlsx-provenance`, plugin `validate` and `native-linux-probe` jobs passed at source SHA `e892291fc03f3f2355106026843c210fc3863a58` (runs [42589674132](https://github.com/ogfrench/frogConvert/actions/runs/42589674132) and [42589674183](https://github.com/ogfrench/frogConvert/actions/runs/42589674183)). The separate build job was still in progress when reviewed.

## Pending proof

- [ ] Run `bun run verify:pdf-merge` on the exact branch and inspect each test result.
- [ ] Run real corpus tests if fixtures and dependencies are available; report skips explicitly.
- [ ] Confirm full CI only after the build job completes and repeat the check at the final PR head.
- [ ] Independent review for unsafe file paths, output integrity, and coverage gaps.
- [ ] Actual browser PDF merge journey and clean-host acceptance if distribution scope expands.
- [ ] Merge or release. No release authorized.

## Next

Reconfirm full CI, execute `bun run verify:pdf-merge` explicitly on the exact branch if not covered by the workflow, and inspect real corpus files where authorized. Evaluate whether the shortcut improves verification before widening coverage. Do not expand the feature inventory merely to increase documentation coverage.
