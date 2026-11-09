# Product Passport: frogConvert pilot scratchpad

Updated: 2026-11-09. Code is the source, documentation is a navigation index.

## Completed in `feat/product-passport-pdf-merge-2026-11-09`

- [x] Inspect existing PDF merge engine, REST, MCP, unit tests, corpus tests, and repository rules.
- [x] Add a native `package.json` script that runs the existing engine, MCP and REST assertions without another test framework.
- [x] Add a small source-path index and project-owned verification skill that calls executable tests rather than treating documentation as a contract.

## Pending proof

- [ ] Run `bun run verify:pdf-merge` on the exact branch and inspect each test result.
- [ ] Run real corpus tests if fixtures and dependencies are available; report skips explicitly.
- [ ] Run full required repository CI and inspect results.
- [ ] Independent review for unsafe file paths, output integrity, and coverage gaps.
- [ ] Actual browser PDF merge journey and clean-host acceptance if distribution scope expands.
- [ ] Merge or release. No release authorized.

## Next

Open a draft PR, confirm exact-head CI, then evaluate whether the shortcut genuinely improves feature verification. Do not expand the feature inventory merely to increase documentation coverage.
