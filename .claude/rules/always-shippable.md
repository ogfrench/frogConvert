# Always-shippable default branch

The default branch must remain releasable after each merge. This is an engineering policy, **not** evidence that the current revision is deployed, fully tested, or production-healthy.

- Keep unfinished or unverified work in a draft PR or isolated branch, not in the default branch. Avoid switching on incomplete features through a premature merge.
- Before merging, check the actual changed code and current PR head, run applicable CI and affected tests, and inspect at least one real changed user journey plus an important failure case when behavior changed. For documentation-only changes, validate paths, claims and links; say explicitly when execution was not applicable.
- Do not waive a failing check as "just CI", weaken security/privacy gates, or turn off tests for a green badge. Investigate failures, fix their causes, and rerun at the new head.
- In the PR, record implemented, tested, runtime-verified, merged, deployed and released as different states, including any blocked or skipped evidence. Update relevant Product Passport entries in the same PR.
- A source merge never grants production-deploy authority. Follow the repository's existing runbooks and permissions. If release acceptance cannot be established, hold the PR and state the blocker.

Additional frogConvert gate: for conversion changes, prove actual input/output bytes through the applicable format matrix, service-worker and fallback flows. A passing route graph or preview deployment alone does not prove formats convert correctly.
