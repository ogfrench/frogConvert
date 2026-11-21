# Conflict-aware parallelism

Use this protocol when multiple coding agents may change the same product. The executive retains the user conversation, authorized scope, integration and PR checklist. Do not create a scheduler or repository-wide locks by default.

## Determine independence by behavior

Inspect actual source, tests, dependencies, active branches and the product's canonical state owners. Record the affected capabilities, invariants, interfaces, shared mutable artifacts and run environments.

| Classification | Meaning | Default |
| --- | --- | --- |
| Independent | No shared writable state or behavior-dependent contracts; interfaces already stable | Parallel work in isolated branches/worktrees when beneficial |
| Contract-dependent | Separate implementations rely on a common API, schema, event or generated output | Establish one reviewed contract first; partition implementation and verify integration |
| Conflicting | Competing changes to one invariant, migration, owner, release artifact or watched runtime | Serialize or designate one writer; resolve the design before implementation |

Different files can conflict semantically. Two edits in one file can be compatible. Git mergeability is not a correctness check. Prefer shared read-only inputs; allocate independently writable outputs. When isolation is not viable, work sequentially.

## Execution and integration

1. Give each worker a bounded task with expected behavior, relevant paths, agreed contracts, negative cases, allowed tools and non-goals.
2. Use separate worktrees, dependencies, ports and test databases where writes could interfere. Read-only reviewers must not trigger side-effecting builds in another agent's working tree.
3. Before combining work, inspect each diff against the latest target head and reconcile API signatures, schema changes, authorization, state transitions, generated assets and migration order.
4. Integrate through the existing PR process. Run relevant cross-feature regressions and actual user journeys on the combined revision, with races and negative cases when appropriate.
5. Record exact head, checks executed, conflicting decisions, unresolved findings and who can authorize merge. Do not tick the checklist based solely on isolated agent reports.

Stop parallelism if workers repeatedly wait for each other, share unisolated state, or coordination/review costs more than the work. Prefer one capable agent unless measured quality or latency improves.

## Decision examples

- One agent changes button copy, another updates a separate offline data import: probably independent after confirming no shared build artifacts.
- One agent implements a save button while another changes its API response: contract-dependent despite different files.
- Two agents alter how a live quiz session closes and accepts answers: conflicting unless one owner defines and verifies the transaction invariant.
