---
name: model-delegation
description: >-
  Choose the main agent, a reusable skill or tool, or a subagent using measured
  quality, context and cost. Use for delegation, model splits, agent workflows,
  orchestration design, cheaper models, and latency optimization.
---

# Model delegation

**Default to one main agent loop with skills and tools loaded on demand.**
Keep the user's conversation, decisions, permissions and final verification
in that loop. Subagents are not obsolete; they must earn the extra context
transfer, latency, tokens and coordination. A low token price is not a saving
if an agent needs a long brief, a second run and a full review.

## Choose the smallest effective component

| Job | First choice |
| --- | --- |
| Decision, synthesis, short or tightly coupled work | Main agent |
| Repeatable procedure or domain reasoning | On-demand skill |
| Live data or a bounded external action | Tool, CLI or MCP with authorization checks |
| Large facts or documents | Targeted reference lookup |
| Isolated adversarial review or context-heavy bounded analysis | Subagent, if evaluated |
| Truly independent tasks with separate state | Parallel work, if evaluated |

Do not mirror the organization chart with a router, planner and specialist
for every domain. Merge specialists that share data, chain frequently, or
repeat context. The main agent should usually call a retained specialist as
a tool and inspect its result, rather than handing over the conversation.

## Risk-gated adversarial review

The main agent remains **executive** and owns framing, implementation, the PR,
verification and decisions. Routine changes do not need a committee. Material
uncertainty may warrant one independent critic; high-consequence cross-boundary
work may need two or three read-only critics with different concerns, before
expensive design commitments and before merge. Escalate for risk, not file count.

A **judge** is optional for conflicting or numerous findings. It deduplicates,
checks evidence and preserves credible dissent; it cannot waive gates, approve
releases or vote away a reproduced defect. The executive must reconcile each
material finding, explain rejections and verify corrections. Agreement among
agents is not proof.

Only when escalation is justified, load the
[risk-gated review protocol](references/risk-gated-review.md). Do not introduce
a permanent orchestration tier or pretend the host can spawn agents.

## Compare before adding or folding an agent

1. Write end-to-end cases **before** changing architecture: ordinary requests,
   ambiguous cases, multi-specialist chains, access boundaries and rules
   that must never be violated. Repeat flaky or stochastic cases.
2. Run the existing design and the proposed main-loop/skill/tool version
   on the same cases. Change one boundary at a time.
3. Compare task completion, individual regressions, missing tool calls,
   output correctness, tool/skill selection, total cost and latency.
4. Keep a subagent if tests show better accuracy, needed isolation from
   bloated or conflicting context, or safe parallelism. Do not average away
   a broken permission check or missing required lookup.
5. Re-evaluate when models, prompts or tools change. If there is no baseline,
   label the architecture a hypothesis rather than a measured improvement.

## When delegation is justified

- Pick the cheapest **currently available** model that passes the test cases.
  Account models and effort settings change; inspect `/model` instead of
  assuming fixed Haiku/Sonnet/Opus capabilities.
- Hand off a self-contained brief: outcome, paths, decisions, allowed commands,
  non-goals, required checks and a short report format.
- Keep independent reviews read-only and restrict commands. The
  `cheap-reviewer` remains a useful independent boundary until evaluation
  proves the same findings emerge without it.
- Parallel writes need separate worktrees, ports and state. Shared databases,
  rate limits and watched browser stacks run serially.
- Before parallel implementation, classify tasks by shared behavior, contracts and
  invariants, not only file overlap. For independent, dependent and conflicting work,
  use the [conflict-aware parallelism protocol](references/conflict-aware-parallelism.md).
  Successful isolated branches are not proof of a compatible integrated product.
- For source-derived work, partition writable outputs, not source access;
  workers may share read-only canonical inputs. The main agent runs shared
  generation and acceptance checks. Workers flag source omissions or
  conflicts rather than silently repairing them.
- An agent report is a claim. Re-check its findings, diff and test evidence
  in the main loop before merging or reporting success.

## Stop signals

- Brief plus verification exceeds the work or repeatedly omits context.
- Specialists wait for each other's output or edit the same resources.
- The simplified loop matches quality with lower latency and fewer failures.
- Two corrections fail to fix the delegation. Re-scope or take the work back.

Source: https://claude.com/resources/articles/building-agents-when-to-fold-subagents-into-your-main-agent-loop
Research and evaluation plan: `docs/claude-practices-2026-10.md`.
