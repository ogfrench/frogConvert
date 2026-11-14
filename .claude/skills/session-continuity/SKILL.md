---
name: session-continuity
description: >-
  Preserve PR checklists and evidence through compactions and multi-agent handoffs.
  Use for session continuity, progress checkpoints and handover.
---

# Session continuity

A compaction swaps the conversation for a summary. Anything that lived only in the
conversation is now a paraphrase, and the summary is written without seeing the last few
turns. Long work survives that when its state lives outside the conversation, where the
next context can read it, and when the next context checks the world before acting.

## Where state lives

Put each kind of state in the one place built for it, at the moment it changes:

| State | Durable home |
| --- | --- |
| The plan for the current step | a plan file, one per step |
| What is done, what is next, what waits on whom | the live PR description checklist; an issue or plan file before a PR exists |
| A decision and its reason | the project's decision log, with the user's words and the date |
| A rule that keeps holding | the project's `CLAUDE.md` |
| What changed | the changelog and the commit messages |
| Work in progress | a commit on a pushed branch, not a dirty tree |
| Where things are | worktree paths, branches, how to run the checks: `CLAUDE.md` or the tracker |

When a PR exists, keep its description authoritative for the current work. An issue tracks
broader scope and follow-ups, not a competing copy of the PR's status. Update the checklist
as steps finish, fail, or change; do not defer updates until the end of a session.

## PR-first execution checklist

1. Before changing a repository, list the outcomes and proof as checkboxes.
   Use a durable issue or plan until a PR opens; then keep the PR description
   authoritative. Replace template placeholders with specific tasks.
2. Check an item only when evidence proves its acceptance criterion. Record
   the command, result, runtime and revision. Failed, blocked or unrun checks
   remain open; a commit or CI status alone may not prove actual behavior.
3. After meaningful steps and context changes, re-read the branch, PR head,
   checks and review threads; update the checklist. Reopen verification made
   stale by later edits.
4. Before handover, record exact head, completed work, testing, deployment,
   unresolved reviews, risks, decisions, owner and next step in the PR.
5. Before review or merge, reconcile every required gate; defer only explicitly
   to a linked owning issue, never silently discard an open release blocker.

Use [before/after proof](references/before-after-proof.md) to preserve the
baseline, working scratchpad, comparable results and exact revision across
interruptions.

See [PR progress and handover](references/pr-progress.md) for examples and
multi-agent edits. A checklist never grants merge or deploy authority.

## Coordinate with Delivery Loop

Use `delivery-loop` for active implementation and CI repair. This skill owns
durable PR progress, review checkpoints and precise handovers.

## Record the user's words

A summary paraphrases, and paraphrase is where "keep my account" becomes "keep the
accounts".

- Write each decision with the user's exact phrase and the date.
- Write the scope of an authorization, not only that one was given: "merge stuff" covered
  the PRs open at the time. A new risky change asks again.
- Write an open question as open, with who decides it. A guess recorded as a decision is
  worse than a gap.

## Check-ins that stand alone

A scheduled check-in or wakeup may fire after a compaction, or into a fresh session. Write
its prompt so it works with no memory:

- what it is about: the PR number, branch and head commit
- what to check: CI, merge state, open threads
- what to do in each case: red means root-cause and fix, green means merge, tick the
  tracker and tell the user
- the authority for that action, quoted with its date

Cancel it once its job is done, so a stale prompt cannot act on a later state.

## After a compaction

1. Read the summary's pending list, then the verbatim turns kept after it. Something the
   summary calls pending may already be done.
2. Check the world before acting: `git status` and `git log` in each worktree, the PR's
   checks and merge state, the tracker. The summary is a claim, like an agent's report.
3. Carry on with the next step, no recap. Where the summary and the world disagree, the
   world wins; say so in one line.

## Check the work against the plan

At the end of each step, and after every compaction, put the plan beside what was done:

- Mark each plan step done, done and verified, or not done. A verification step in the plan
  is work, not a note: run it, or say it was skipped and why.
- Explain in one line any number in the plan the result disagrees with, such as a file
  count or a test count. A wrong number in a plan hides a wrong assumption.
- Tasks in the task list or the tracker that the summary dropped stay open until someone
  closes them on purpose. Walk the list, not the summary's version of it.
- Name any work done that the plan did not ask for.

## Raise what does not fit

Say inconsistencies and open points out loud, at the top of the report, without waiting to
be asked:

- the record contradicts itself, or the user's new words contradict an earlier decision
- a go-ahead is being stretched past what it covered
- an instruction has two readings, and the choice changes the outcome
- a plan step turned out wrong, or was quietly skipped

Give each the options and a recommendation, then carry on with what it does not block.

## Before a compaction or a long pause

Save the work in an authorized branch or durable local file, tick the tracker,
update the plan, and record open questions. Commit and push only when authorized,
with applicable checks and repository rules satisfied. The summary can then
point at those records rather than carry them.

## Do not

- Keep a to-do list only in the conversation or a scratch folder. The next session cannot
  see either.
- Trust a remembered commit, count or test result after a summary. Fetch it.
- Re-ask a question the record already answers. Read the decision log first.
