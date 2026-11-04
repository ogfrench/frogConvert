---
name: actions-cost
description: >-
  Reduce GitHub Actions costs while preserving PR checks, security and deployments.
---

# Optimize GitHub Actions cost without weakening CI

Use for requests about CI bills, too many runs, budgets, slow jobs, merge-trigger
duplication, matrices, caching, or workflow optimization. Always start with the real
workflows and recent run history, not a generic YAML recipe. Read
[the implementation reference](references/ci-audit.md) when changing workflow files.

## 1. Inventory and measure before editing

1. Read *all* `.github/workflows/*.yml` and `*.yaml`, branch rules, required
   status checks, deployment/image publishing, releases, schedules and environments.
   Distinguish validation, publishing, deployment, monitoring, and security jobs.
2. For every workflow, list the events (`push`, `pull_request`, `merge_group`,
   `workflow_dispatch`, `schedule`), branches, paths, matrices, runners and
   concurrency groups. Identify jobs that repeat on the PR and again on merge.
3. Inspect actual job durations and counts: `gh run list`, `gh run view --json jobs`,
   GitHub MCP, or Actions > a run > Usage. Runner-minutes are the **sum of job
   times**, not workflow wall time. For billable private-repo GitHub-hosted jobs,
   GitHub reports execution minutes rounded up per job; apply current runner rates.
4. Establish repo owner, public/private status, runner type, plan allowance,
   remaining usage, storage, and budgets. Do not infer a user's personal billing
   settings from a repo. Check current GitHub pricing, not a stale quoted rate.
5. Write a baseline: monthly runs × billable minutes per job × runner rate,
   plus artifact/cache storage beyond allowances, and estimate post-change savings.
   Call out multi-architecture builds and matrix fan-out.

## 2. Avoid duplicate PR/merge validation

- When **PR checks are mandatory and direct default-branch pushes are blocked**,
  validate the merge candidate on `pull_request` and remove `push` on the default
  branch from **validation-only** workflows. Preserve `workflow_dispatch`.
  A green PR does not literally cache a test result for `master`; removing the
  merge-triggered run is a deliberate safety/cost tradeoff.
- Keep `push` on publishing, releases, deployments, migrations and other
  post-merge effects. Split test and publish jobs; retain security schedules.
- Do not make validation PR-only until checking required status checks, branch
  protection/rulesets, bypass rules, and whether the repo merges via PR at all.
  If direct pushes are allowed or protection cannot be confirmed, state the risk
  and request protection before shipping PR-only enforcement.
- PR checks normally check out GitHub's synthetic merge ref; protect against
  stale PRs by requiring up-to-date checks or a supported merge queue.
  For a merge queue, add `merge_group` to every **required** Actions workflow.
  Do not recommend merge queues without checking repo/plan availability.
- Preserve path filters cautiously. A required *workflow* skipped by `paths`
  can remain Pending indefinitely. Prefer a stable always-started required job
  with inexpensive changed-file detection and conditional costly steps.
- Keep meaningful checks at every commit needing validation. Label/manual
  gating is suitable for expensive *optional* E2E, not a required check whose
  status must prove the latest commit was tested.

## 3. Reduce unnecessary work, not test coverage

- Fast checks every push; heavy E2E once per release. Make the release one PR,
  merge related branches into it, and push review fixes to it: a "ready" or
  label gate lets them ride along. Run touched specs locally, say so; re-run
  only for a risky fix. Old green E2E proves nothing new.
- Add `timeout-minutes`. Measure retries, sleeps, repeat installs, duplicate
  builds and big matrices before removing a test; never truncate suites.
- Use lockfile-keyed dependency caches, verify cache hit times, and do not
  cache secrets or untrusted executable state. Artifacts are for passing build
  outputs between jobs, not for hiding missing tests.
- Use `concurrency` and `cancel-in-progress: true` only where superseded work
  is safe to cancel. Give PRs distinct groups. **Never** cancel a deploy, image
  publish, migration, or a one-shot expensive run because of an unrelated event.
- Review large-runner cost, reusable workflows, artifact retention, backups,
  schedules and cross-repo Actions usage. Publish once and reuse the artifact.

## 4. Budgets and operational guardrails

- GitHub Settings > Billing and licensing > Budgets and alerts: inspect Actions
  usage, included-minute alerts, and product-level or account-level budgets.
  Turn on threshold notifications. A budget without **Stop usage** is an alert,
  not a spending cap. A hard stop can block CI; set it deliberately.
- Public repos on standard GitHub-hosted runners generally use free Actions
  minutes; private repos consume plan allowances. Larger runners and storage
  follow separate billing rules. Check current docs and the owner account.
- A job failing immediately with no runner/log **may** be exhausted billing,
  policy, permissions, concurrency or an Actions outage. Check the run's
  annotations and billing before claiming a code failure or rerunning blindly.
- Actions cost is not cloud hosting/deployment cost. Audit hosting provider
  build minutes, deploy previews and artifact/image registry retention separately.

For retry discipline, runner-cost thresholds and final-SHA full-suite verification,
see [the detailed audit reference](references/ci-audit.md).

## Deliverable and change policy

Report a before/after trigger matrix, the measured or estimated runner-minutes
saved per merge and per month, remaining required post-merge work, and any
unverified branch-protection or billing assumptions. When modifying a repo:
create a branch and PR, preserve its checks, inspect the diff, and do not merge
without authorization. Keep sensitive repository details out of public skills.

See [reference, YAML patterns and calculator](references/ci-audit.md).
