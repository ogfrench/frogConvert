# Read-only architecture audit contract

A gardener's finding must be grounded in code, not a diagram or an attractive abstraction.

## Evidence ladder

1. **Observation:** precise source path, boundary and exact revision; state the concrete difference or repeated workaround.
2. **Reproduction:** existing executable test, failing user path, incident trace, or a safe negative fixture. Do not run an unknown project's migrations, seeders or destructive test suites by default.
3. **Causality:** explain why the observed structure allows the failure; look for a legitimate alternative design and an unaffected control path.
4. **Correction:** narrow owner/boundary fix and an executable regression. Give a no-change option when the evidence is insufficient.
5. **Enforcement:** prefer a focused test over a repository-wide lint ban. Start advisory and require proof of low false positives before CI enforcement.

## Report shape

| Field | Required meaning |
| --- | --- |
| Scope | Repository, ref/SHA, inspected module or behavior and excluded areas |
| Claim | Verified defect, supported risk, hypothesis, or healthy difference |
| Evidence | Code path plus actual observed or executed proof; cite individual paths |
| Consequence | The failure mode, who experiences it, severity and likelihood |
| Countercase | A plausible benign reason for the design; test or inspect it |
| Action | Minimal repair, measurable guard and rollback, or leave unchanged |
| State | Passed, failed, blocked or not_run; never silently upgrade a hypothesis |

Do not present estimated risk scores as measurements. Include exact command outputs only when actually executed. For private repos, keep paths, screenshots, fixtures, credentials, deployment URLs and client details in the private report.

## Pilot design

Compare one architecture task with and without the skill on the same pinned source and model/host conditions. Include a positive structural case, an ordinary feature task that must not trigger, and an ambiguous pattern with a legitimate counterexample. Measure correct findings, unsupported findings, needless refactors, task completion, latency and cost. A green parser or eval fixture only establishes source validity, not demonstrated agent benefit.
