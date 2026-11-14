---
name: delivery-loop
description: >-
  Finish authorized repository tasks through code, tests, CI and PR review.
  Use for end-to-end delivery and release handovers.
---

# Delivery Loop

Own an **authorized, bounded outcome** through implementation and verifiable handover, not
just a plan or a status report. Default to one main agent using existing project tools and
specialist skills. Autonomy means progressing without needless questions **within granted
permissions**, not inventing access, bypassing controls or declaring an unfinished task done.

## DUNE delivery invariant

For a product-facing change, enter through the product-owned capability map, verify real source and test ownership, follow the existing paved path, implement a focused regression, and exit through observed behavior plus reconciled passport evidence. The PR is the only authoritative live tracker. Do not create another DUNE board, duplicate agent, or infer functional success from static path checks. Enforce architecture constraints only when relevant to the target stack and a demonstrated failure mode.

## Run the loop

1. **Orient.** Read the user's objective and permissions, current source, tests,
   instructions, existing PRs/issues and branch state. Identify the real acceptance
   conditions, non-goals, dependencies and safety gates. Code and observed behavior
   outrank documentation; neither proves requirements are correct.
2. **Plan in the PR.** Write a short checklist of outcomes and evidence. Use a durable
   issue/plan until a draft PR exists, then make the PR description the current tracker.
   Reuse an existing owning PR rather than creating duplicate branches or trackers.
   See `session-continuity` for live checkpoints and second-agent handovers.
3. **Implement deliberately.** Follow the existing stack and paved paths. Read owning
   code, dependencies and tests before edits; fix root causes and add a targeted
   regression. Avoid broad refactors, speculative abstractions or unrequested
   framework changes. Use `best-practices` for relevant topic rules, `product-passport`
   for features/maps and task proof, `architecture-gardener` only if actually
   available and structural root causes justify it, and `visual-loop` for
   user-facing visuals. Do not load all specialists by default.
4. **Prove the result.** Establish a reproducible baseline when feasible, then
   repeat the same user journey or artifact after editing. Use test-strategy for
   proportionate test selection and session-continuity for
   [before/after evidence](../session-continuity/references/before-after-proof.md).
   Test changed behavior, negative paths and meaningful real
   journeys in an isolated environment. Distinguish static inspection, local tests,
   CI, host acceptance, deployed and production-verified. Investigate failed checks
   from evidence, fix the cause and rerun at the **new exact head**. Never dilute
   a gate, self-approve risk, fabricate screenshots or claim a check ran without proof.
5. **Reconcile and review.** For risky releases, consult
   [production readiness](references/production-readiness.md) before deploy.
   Update the PR checklist after each meaningful change.
   Reopen items invalidated by later commits. Inspect the final diff, changed scope,
   CI and review threads; use an independent reviewer when risk warrants it.
   Update product maps, docs, regressions and the changelog where applicable.
6. **Finish or hand off truthfully.** Merge, release, deploy or close issues only if
   authorized and the actual gates pass. Otherwise preserve work in a reviewable
   branch and put a precise next action, owner, blocker and proof gap in the PR.
   Recheck live state before reporting completion. Use `learning-loop` to capture
   repeatable lessons, not to replace unresolved delivery work.

## Recovery and limits

- A run with zero jobs is not a test failure: inspect Actions billing, policy, permissions and scheduling first. A job that executed and failed requires its own logs and root-cause fix.
- If blocked, inspect logs and try a materially different diagnosis, not repeated
  identical retries. Continue independent safe tasks; surface a genuine access,
  decision or environment blocker with the smallest actionable next step.
- Prioritize a working deliverable over performative planning. Keep checklists concise
  and update them; do not spawn agents, issues or PRs merely to signal activity.
- One agent owns the authoritative PR checklist. Parallel agents may implement
  isolated work, but their reports require verification before ticking acceptance.
- This skill does not grant repository access, credentials, production privileges,
  autonomous background execution or permission to override the user's stop request.

## Final answer contract

State the exact outcome and links; what was changed; which commands, environments and
revisions were **actually** verified; unresolved risks; whether code was merged,
installed, deployed or released; and the next step if anything is unfinished.
