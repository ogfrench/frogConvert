---
name: test-strategy
description: >-
  Choose unit, integration, E2E or host tests based on code change risk.
---

# Test strategy: prove the changed behavior

Read the implementing code, requirements, existing tests, runtime boundaries and
repository release gates before selecting a test. Choose the *cheapest reliable proof*
of the failure, then add a broader test when it catches a different failure class.
Do not treat a passing test as proof that the product meets requirements by default.

## Select the test

1. Identify what changed, which user outcome could break, and where the relevant
   boundary is: pure logic, database, service, browser, external API or installed host.
2. Inspect existing coverage. Select a focused regression that would fail on the old
   defect when feasible. Use the [decision matrix](references/decision-matrix.md) to
   distinguish tests that actually prove different things.
3. Cover meaningful negative paths, permissions, concurrency, retries, failure
   recovery and persistence when they are relevant. Avoid testing only mocked calls.
4. Determine whether an *actual* end-to-end journey is required to test components
   together. For auth, account ownership, real-time games, destructive migrations,
   conversion outputs, plugin installation and cross-process workflows, favor an
   affected real journey. Do not default every change to the entire browser suite.
5. Separate **test coverage** from **test execution schedule**. Focused tests while
   editing; cheap PR gates on changed revisions; required risk-based broad suites and
   security checks on the final accepted SHA. Consult actions-cost for scheduling
   and budgets, but never weaken required proof to save minutes.
6. Use isolated state and wait for observable readiness, not arbitrary sleeps.
   Investigate flakes rather than masking them with retries. See
   [reliability](references/reliability.md).
7. Record what ran, exact commit and runtime, outcomes, before/after evidence,
   justified skips and remaining gaps. A skipped, blocked, stale or waived test is
   **not** a pass.

## Boundaries

This skill owns choosing sufficient tests. Delivery-loop owns execution and PR
handover; product-passport owns affected feature journeys; security-review owns
trust-boundary threats; visual-loop owns render inspection. Keep the product's own
test runners, required checks and deployment safeguards. A documentation-only edit
does not automatically require E2E; a small auth change may still require it.
