---
name: release-readiness
description: >-
  Audit final-SHA merge, packaging and release readiness.
---

# Release Readiness

Own the release decision for the **exact final commit**, not the appearance of green checks.
Use with `delivery-loop`: it owns implementation and handover; this specialist audits
release-specific failure modes. Do not create duplicate release trackers or require
a particular CI provider.

## 1. Establish the release contract

Read the PR diff, target branch, version/tag rules, build and deploy configuration,
lockfiles, workflow triggers and conditions, packaging code, release manifests,
documentation and rollback path. Confirm authorization to merge/publish separately
from evidence that it is safe. Record the exact head SHA and intended release version.

Map required gates and their actual status: passed, failed, skipped, cancelled,
pending or not run. A green workflow with skipped visual/release jobs is **not**
equivalent to full acceptance. A successful preview build is not proof that
production-mode artifact verification passes.

## 2. Anticipate downstream failures before expensive runs

Read **every downstream step** of the failing workflow, not just its first error.
Cross-check route assertions against actual site generation and rewrite rules;
test selectors against rendered DOM; compare assertion property names with values
actually returned; check navigation, redirects, generated assets, paths and casing.
Identify missing files, stale URLs, contradictory workflow conditions, unbounded
build work, missing artifacts and tests that cannot fail when behavior regresses.
Distinguish application defects, test defects and environment failures.

For generated artifacts, trace source -> generator -> output -> publisher.
Do not repair a test by removing a legitimate assertion or treating 404 as success.
Fix the production path when it is missing; fix the test when its expectation is wrong.
Add focused regressions for the defect. Prefer cheap route/manifest/selector smoke
checks **before** a long browser build. If a full build takes significant time,
measure its stages and avoid identical reruns without a new hypothesis.

## 3. Verify packages and immutable release assets

Use pinned runtime and clean lockfile dependencies. Generate each distribution
from the final source; inspect plugin manifests, skills, commands, entry points,
host-specific instructions, downloads and documentation for consistency.
Compare versioned and latest aliases and verify content digests. Never repin
published immutable assets or bypass checksum guards to make CI green.
For an unreleased candidate, repin only with the repository's authorized
procedure and verify a subsequent clean production-mode build.

### Release-asset closure (mandatory)

Build a **delivery inventory** from promised downloads and prior release assets:
filename, version, source commit, generator, workflow trigger, attachment step,
checksum and privacy scope. An Actions `upload-artifact` preview is **not** a GitHub Release asset.
A `gh release create` without ZIP paths is a **notes-only release**, even with green CI.

Trace trigger -> build -> validate -> upload; fail if required files or checksums
are absent. Enforce release-tag/commit parity and regressions for missing asset,
stale version/commit, bad checksum, and privacy scope. Build all required files
before publishing, attach together, and never overwrite published immutable ZIPs.
Keep restricted data and credentials behind their existing authorization gates.

After publication, inspect actual assets, download and verify their checksums.
Release publication does not update accounts or prove MCP authentication.
Mark a release **incomplete** if promised assets are missing despite green CI.

## 4. Prove behavior, not just compilation

Run proportionate unit/integration tests and real user journeys in the target
host or representative browser. Check desktop/mobile, negative paths, links,
search and controls, visual geometry, browser errors and downloadable outputs
as relevant. Capture authentic evidence and inspect it; static geometry checks
do not replace visual inspection. Record what was actually tested, with SHA,
environment, artifact and workflow links. A failed or cancelled check stays open
until rerun successfully at the final SHA.

## 5. Final merge and post-release gate

Reinspect the final diff, release notes, version/tag alignment, security exposure,
temporary workflows, credentials, generated files and CI permissions. Confirm
required checks and reviews on the final SHA. Merge only when authorized and
the actual gates pass; never infer merge from a request or CI success.
Verify the merge SHA, tag/release, deployment, downloads, installed plugin
versions and rollback availability separately. If host access is missing,
leave a precise blocked handover rather than claiming completion.

## Failure-chain discipline

When any gate fails:
1. Capture the exact error and classify source, test, packaging, infrastructure
   or permissions; avoid guessing from a spinner or cancelled run.
2. Inspect remaining steps for independent deterministic failures **before rerun**.
3. Repair root cause with a regression, verify cheaply first, then rerun the
   smallest meaningful workflow at the new SHA.
4. Update the PR's single authoritative checklist with observed proof and gaps.

## Output contract

Report: exact head/merge/release SHA; version; pass/fail/skipped/pending gates;
source and artifact evidence; root cause and downstream risks; actions performed;
merge, release, deployment and installation status as distinct facts.
State the blocking next action plainly. Do not claim tests, screenshots,
published assets or deployment were verified unless they were.
