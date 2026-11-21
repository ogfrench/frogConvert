---
name: delivery-loop
description: >-
  Deliver authorized coding tasks through tests, PR review and release.
---

# Delivery Loop

Own an **authorized, bounded outcome** and long-term codebase maintenance through
implementation and verifiable handover. Default to one main agent with existing
skills and tools. Autonomy stays within granted permissions: no invented access,
bypassed controls or claims that unfinished work is done.

## DUNE delivery invariant

For a product-facing change, enter through the product-owned capability map, verify real source and test ownership, follow the existing paved path, implement a focused regression, and exit through observed behavior plus reconciled passport evidence. The PR is the only authoritative live tracker. Do not create another DUNE board, duplicate agent, or infer functional success from static path checks. Enforce architecture constraints only when relevant to the target stack and a demonstrated failure mode.

## Frame–Propose–Evaluate (FPE)

- **Frame:** inspect source and behavior; state outcome, assumptions and proof.
- **Propose:** choose the smallest sound change; compare options only for
  decisions with material uncertainty.
- **Evaluate:** verify requirements and observed behavior; reframe if
  evidence disproves the diagnosis.

FPE is iterative reasoning, not gates or agents. Routine fixes need one
short pass. For costly ambiguity or high risk, use `model-delegation` for
independent critique before commitment or merge. One executive owns delivery.

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
   user-facing visuals. Do not load all specialists by default. For derived
   outputs, trace authoritative input, transformation code and output
   contract. Flag missing source; never invent it.
   Protect the last accepted artifact before destructive builds; avoid
   unrelated changes.
4. **Prove the result.** Establish a reproducible baseline when feasible, then
   repeat the same user journey or artifact after editing. Use test-strategy for
   proportionate test selection and session-continuity for
   [before/after evidence](../session-continuity/references/before-after-proof.md).
   Test changed behavior, negative paths and meaningful real
   journeys in an isolated environment. Distinguish static inspection, local tests,
   CI, host acceptance, deployed and production-verified. Investigate failed checks
   from evidence, fix the cause and rerun at the **new exact head**. Never dilute
   a gate, self-approve risk, fabricate screenshots or claim a check ran without proof.
5. **Reconcile and review.** Before an authorized merge or release, invoke
   `release-readiness` to inspect the exact head, downstream workflow steps,
   skipped gates, generated routes, packaged downloads and host acceptance.
   For risky deployments, consult [production readiness](references/production-readiness.md).
   Update the PR checklist; reopen items invalidated by later commits. Inspect the final diff, changed scope,
   CI and review threads; use an independent reviewer when risk warrants it.
   Keep executable regressions. Update affected map pointers or state `map unchanged`. Avoid unsolicited changelogs.
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
  Verify shared contracts and behavior after integrating their changes at the final head.
- This skill does not grant repository access, credentials, production privileges,
  autonomous background execution or permission to override the user's stop request.

## Final answer contract

State the exact outcome and links; what was changed; which commands, environments and
revisions were **actually** verified; unresolved risks; whether code was merged,
installed, deployed or released; and the next step if anything is unfinished.
