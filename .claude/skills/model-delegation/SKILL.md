---
name: model-delegation
description: >-
  Decide which model does each piece of work when a session can hand tasks to
  subagents on cheaper models (haiku, sonnet) and keep the rest on the main one.
  Use when planning multi-step work, before launching subagents, and when the
  user asks to use cheaper models, delegate, save tokens or go faster. Triggers:
  "use sonnet", "use haiku", "cheaper agents", "delegate this", "model split",
  "/model-delegation".
---

# Model delegation

**The rule:** hand a task to the cheapest model whose mistake would be caught, cheaply,
before it lands. Keep on the main model what is hard to check, or costly to get wrong.

Cheaper tokens are not the saving by themselves. A brief costs tokens, and so does
checking what comes back. Delegate when the task is big enough to repay both, and its
result is easy to check.

## The split

| Model | Give it | Why it fits |
| --- | --- | --- |
| **haiku** | Mechanical work: run a suite and summarise the failures, read a CI log, sweep a repo with grep and list what it finds, take screenshots, update counts and stale lines in docs, draft changelog lines from a diff, check a status | A mistake shows at once and costs little. |
| **sonnet** | Bounded work with a spec: a feature with its test written first, a lightweight review of one commit, first-pass triage of findings (a visual review, lint), a doc drafted from a known structure, research with sources | A test, a review or the main model checks it before anything lands. |
| **The main model** | Design and decisions; anything touching auth, sessions, permissions, money, deleting data, migrations, concurrency and races; integrating what agents produce; reviewing it; milestone reviews; anything the user approves | The bugs here are subtle, and one costs more than the whole saving. |

## Deciding, task by task

Ask these in order. The first answer that points to the main model wins.

1. **If it is wrong, who notices, and when?** A failing test or CI points to a cheaper
   model. A user, in production, points to the main model.
2. **Can it be undone?** Deleting data, a migration, a message posted outside, a push to
   someone else's branch: main model.
3. **Is the spec complete?** If the agent would have to make a design choice, make it
   first, write it into the brief, then delegate. Never delegate the decision along with
   the work.
4. **Does it need the whole conversation?** When the brief would be longer than the
   work, do it yourself.
5. **Is it small?** A change of a few lines is faster to make than to brief.

## Briefing a cheaper agent

- **Self-contained:** the goal, the paths, what done looks like, the test to write first,
  and what it must not touch. It has none of your context.
- **Say what is decided,** so it does not reopen it.
- **Read-only by default** for reviews and audits, and say so in the brief.
- **Ask for a short report in a fixed shape:** severity, `file:line`, the problem, a
  concrete scenario, under a word cap. "Say plainly if you find nothing."
- **Name the commands** to run and the ones to never run (stopping shared services,
  deleting data, pushing).

## Running agents in parallel

- **One file, one agent.** Agents that edit work in separate worktrees, on separate
  files. Two on one file overwrite each other.
- **Shared resources run one at a time:** one local stack and its ports, one test
  database, rate limits keyed by address. Give each agent its own database name or port
  offset, or run them in sequence.
- **A dev server that watches the tree** reloads open pages whenever anything is
  written. Don't edit, or start a second stack from the same tree, while browser tests
  run.
- **Cap the number at once.** Git proxies, API rate limits and usage limits all bite. A
  background agent can stop mid-task at a limit, so ask for work that leaves something
  usable when cut short, and resume rather than restart.

## Checking what comes back

- **A report is a claim, not a fact.** Before acting on one that matters, check it: re-run
  the failing test, read the diff, reproduce the finding.
- **A cheap review on every commit,** and a main-model review at each milestone.
- **Fix findings in follow-up commits,** and review again when the fix touches risky code.
- **Tell the user which reading you took** when a report is ambiguous.

## Signs it is going wrong

- The brief keeps growing: the task needed the main model's context.
- The same agent's work fails review twice: take it back.
- Agents edit the same files, or wait on the same service.
- "All tests pass" with no output attached.
