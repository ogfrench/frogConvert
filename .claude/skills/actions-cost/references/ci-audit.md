# GitHub Actions cost audit: implementation reference

Use this only after reading the workflows and status requirements of the target repo.

## Audit commands

```sh
gh workflow list
gh run list --limit 40 --json databaseId,event,conclusion,workflowName,createdAt,headBranch
gh run view RUN_ID --json jobs
gh api repos/OWNER/REPO/actions/workflows --paginate
gh api repos/OWNER/REPO/rulesets --paginate
```

Inspect the last representative 30 days. Count pushes to active PRs, PR openings,
merges, scheduled runs, manual re-runs, matrix cells, and failures. Compare jobs
rather than workflow elapsed time: parallel jobs bill in parallel.

For each workflow record:

| Workflow | Event + filter | Purpose | Runner | Jobs / matrix | Minutes per job | Runs / month | Required? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Example lint | PR and default-branch push | validate | Ubuntu | 1 | 6 | 30 + 8 merges | yes |

**Formula:** sum over runner jobs of `ceil(elapsed_minutes) × unit_rate`, subject to
the account's included usage and the runner's eligibility. Multiple jobs in one
workflow are summed. An estimate of saving from removing a duplicate push:
`merges/month × sum(ceil(minutes/job) × rate)` if every merge used to trigger it.
Report runner-minutes separately from dollar spend; included allowances and
matrix runner pricing can change the actual bill. Scheduled jobs are additive.
Compare against billing's measured usage when available.

## Separate validation from delivery

Validation-only workflow:

```yaml
name: Frontend checks
on:
  pull_request:
    paths:
      - "frontend/**"
      - ".github/workflows/frontend.yml"
  workflow_dispatch:

jobs:
  frontend:
    runs-on: ubuntu-latest
    timeout-minutes: 12
    steps:
      - uses: actions/checkout@v4
      # validated check steps
```

A publishing workflow may *still* need `push` on the default branch:

```yaml
name: Publish image
on:
  push:
    branches: [main]
    paths:
      - "backend/**"
      - ".github/workflows/publish.yml"
  workflow_dispatch:
# Build the release once and publish the tested artifact.
```

Do not blindly convert an existing workflow with both PR validation and release
publishing into the first example; isolate publishing into a separate job or
workflow and keep its post-merge trigger. Check whether it publishes on tags,
uses OIDC permissions, or runs database migrations.

## Latest-commit checks, paths, and safety

1. Configure repository branch rules to require a PR and matching CI checks,
   prevent bypass/direct pushes, and require checks against a current base when
   useful. A green PR is not proof that arbitrary post-merge changes are safe.
2. GitHub normally validates `refs/pull/<number>/merge`. For merge queues, add:
   `merge_group: { types: [checks_requested] }` to required workflows. Check
   plan support first. Do not globally gate every job to `pull_request`,
   or the merge-group checks will be missing.
3. A workflow skipped by `on.pull_request.paths` may leave a required check
   Pending. To make it stable, remove workflow-level paths for that required
   context, add a cheap job that always reports, and condition expensive steps
   on a trusted diff of the appropriate base. Verify PR events and fork tokens.
4. Use path filters only after auditing scripts that depend on seemingly
   unrelated inputs (Dockerfiles, locks, shared packages, config, and CI files).
5. Protect direct pushes before switching checks to PR-only. If permissions
   prevent inspecting branch protections, label this a blocker instead of
   assuming a PR requirement exists.

## Cancellation without lost coverage

For quick, fully supersedable PR validation:

```yaml
concurrency:
  group: "${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}"
  cancel-in-progress: "${{ github.event_name == 'pull_request' }}"
```

Use a different group for slow, manually or label-triggered one-shot tests.
Do **not** let a `labeled` event that skips its job cancel a running suite.
Deployment, image push, scheduled maintenance and database migration generally
need their own serial, noncanceling groups. Verify status contexts after canceled
runs before enabling required checks.

For expensive optional E2E, consider `pull_request` events
`[opened, ready_for_review, labeled]` plus a strict job `if:` for not-draft,
ready or a specific label. A later push invalidates earlier results, so if E2E
is required, trigger again on the latest head or use merge-queue verification.

## Cache, timeout, matrix, and artifact checklist

- Profile each job step and find CPU work versus idle polling/retries. Reduce
  repeated dependency installs and ensure the cache key includes lockfiles.
- Matrix cost is the **sum of all matrix jobs**. Assess architectures/versions
  that genuinely need per-PR coverage versus a slower scheduled/on-demand pass.
- Share built output via uploaded artifacts; keep build and publish permissions
  separate. Artifact integrity and trusted workflow boundaries matter.
- Use immutable/pinned third-party Actions where appropriate; use least-privilege
  `permissions:`, especially with untrusted PRs. Avoid executing PR code with
  secrets in `pull_request_target`.
- Apply `timeout-minutes` based on observed runtime plus headroom. Set artifact
  `retention-days` appropriate to debugging needs and storage costs.
- Do not assume self-hosting is cheaper: count VM hours, network, security and
  operations. Distinguish hosted builds from hosting provider deploy fees.

## Account usage and budget review

- Review the repo owner account's Actions billing page, not just the PR author's.
- GitHub Settings > Billing and licensing > Budgets and alerts: view current
  included quota, metered usage, Actions budget, and threshold emails.
- Understand the difference between threshold alerts and enforcing a hard stop.
  Alerts do not necessarily halt usage; a hard stop can prevent necessary CI.
- Storage usage (cache, artifacts and packages), larger runners, and provider
  deployment/build pricing can be separate from standard included runner minutes.
- Record a baseline and compare after the next few merges. Don't give a precise
  savings number without run frequency and actual durations.

## Diagnosing runner and infrastructure failures

- A job that fails immediately without runner, steps or downloadable logs might be
  blocked by billing, spending limits, runner availability, repository policy or
  GitHub infrastructure. Inspect the run conclusion, job steps, logs, GitHub
  status and account billing. **Never claim billing is proven without evidence.**
- Do not push code fixes or start repeated reruns while the infrastructure block
  persists. After the owner confirms recovery, retry **only failed jobs** once on
  the existing run; inspect the result and solve any real failure before retrying.
- Before each substantial change, estimate runner-minutes. If the change is
  likely to consume more than about an hour, flag its budget impact before merging.

## Fixed-budget final-commit verification

- Batch changes and run available local checks first. Avoid full browser E2E
  for intermediate commits; use focused E2E during iteration.
- When full E2E is a required merge gate, run the **complete suite on the exact
  final PR head SHA**. A targeted subset does not certify a full suite.
- New commits invalidate head-specific checks. Verify the latest SHA, actual
  successful check conclusions, reviews and mergeability before merging.
- Monitoring and status polling must be read-only. Do not trigger workflows,
  make commits or merge from monitoring without authorization.
- Never drop mandatory test, security or release gates to save minutes.

## Official references (verify current figures)

- https://docs.github.com/en/billing/concepts/product-billing/github-actions
- https://docs.github.com/en/billing/how-tos/set-up-budgets
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
