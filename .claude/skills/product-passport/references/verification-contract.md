# Verification contract

## Evidence tiers

- **Localized:** lint, typecheck, unit checks, or focused invariants, when behavior cannot cross a user-facing boundary.
- **Behavioral:** real app or native executable, representative data, complete feature journey, positive and negative assertions, persisted state/output inspection.
- **High-risk / release:** the product's full required CI plus independent or adversarial review, real-host installation and data/access checks when applicable, and the existing release gate.

Never lower a tier because a diff is small. Authentication, secrets, financial or research claims, destructive operations, private distribution, data migrations, and file-system boundaries require product-specific safety checks.

## Execution

1. Identify the exact commit, expected runtime/build revision, prerequisites, and test-only environment.
2. Inspect existing harnesses and choose the least intrusive tool that can prove the behavior. A browser/CLI action must operate on a real executable artifact, not a mockup. Recorded outputs belong to this execution.
3. Prevent mutations of production accounts, production databases, live user files, or confidential corpora during default verification. Use disposable services, generated fixtures, and least privilege. Never run destructive test scripts before checking targets.
4. Test intended success and at least one meaningful failure or regression path where risk warrants it. Assert result semantics, not only exit status or HTTP status.
5. Review the captured artifact itself: visual images and motion for UI, file structure and content for conversion, persisted state for interactive systems, provenance for research, and installed-host tool availability for plugins.
6. Record the same commit and environment across test results; never combine results from different revisions into one green verdict.

## Outcomes

- `passed`: named assertion executed and succeeded on recorded revision/environment.
- `failed`: executed and did not satisfy the assertion.
- `blocked`: required external dependency, permission, host, or controlled gate unavailable.
- `not_run`: not attempted, including consciously skipped or out-of-scope work.

Overall `passed` is allowed only when all required checks for the claimed scope have passed. A waiver records an accepted exception but never changes blocked/not-run to passed. Distinguish implemented, source-verified, host-verified, deployed, and released.

## Suggested JSON evidence

```json
{
  "feature": "example-feature",
  "source_revision": "<full-git-sha>",
  "runtime_revision": "<full-git-sha-or-artifact-hash>",
  "environment": "isolated-local",
  "scope": "behavioral",
  "checks": [
    {
      "name": "actual-task",
      "result": "passed",
      "evidence": "artifacts/actual-task.json"
    },
    {
      "name": "external-host",
      "result": "not_run",
      "reason": "not required for this local behavioral scope"
    }
  ],
  "overall": "passed"
}
```

A source control diff, screenshot link, or PR comment alone is not a test. In private products, store artifacts with suitable access, retention, and redaction. Public CI cannot upload internal documents, credentials, confidential source text, or private user data.

For high-risk changes, test whether verification can detect a known deliberately broken implementation on an isolated branch or fixture. Self-verification is necessary but not sufficient when the same agent authored both code and assertions.
