---
name: token-efficiency
description: >-
  Fewer turns and tokens for the same work: batching, lean context, background
  waits, facts saved once.
---

# Token efficiency

**Successful cost per task is the target.** Conversation history and tool output can
accumulate across turns. Measure retries, context, latency and verification cost, not
just the price of a model call. Start with one agent and load skills on demand;
`model-delegation` defines when an isolated agent earns its overhead.

## Batch

- Independent tool calls go in one message: reads, searches, edits to different files.
- One shell command beats three: chain with `&&`, and print only what you will read
  (`tail`, `grep -n`, `--jq`, `wc -l`). A command that dumps 500 lines costs those lines
  in every later turn.
- Read the part of a file you need: `grep -n` first, then read with an offset and limit.
- Do not re-read a file you just edited, and do not re-run a check that passed until the
  code it covers has changed.

## Keep context lean

- Start with a focused search in the main loop. Use a bounded Explore agent only when
  isolated high-volume findings would otherwise crowd out important context.
- Long logs stay in files. Quote the failing line, not the log.
- Write a plan once, in a file, and point at it. Do not restate it each turn.

## Wait well

- Run a slow check in the background only if the environment supports it. Collect
  its completion state and exit status before asserting the check passed.
- Start the slow thing first, then do the main-model work while it runs.
- A laptop running two local stacks and two dev servers stalls, and its timeouts look like
  bugs. Before calling something broken, rerun it alone.

## Inspect skill and tool overhead

- Inspect `/context`, `/usage` and `/skill-doctor` where supported. Check whether
  overlapping skills or idle MCP servers consume context before removing them.
- Use `/clear` between unrelated tasks, or a focused `/compact` when decisions
  still matter. Put durable facts in files, not in repeated context.
- Compare one-loop and delegated runs on the same real tasks before optimizing.

## Save environment facts once

Rediscovering the environment is the most common waste: where a binary lives, how to start
the local stack, which helper runs the backend tests, how to reach the server, why a tool
fails on this machine. The first time one costs more than a turn, write it down where the
next session reads it: the project's `CLAUDE.md`, a project skill, or memory. Put helper
scripts in the repo, not in a session's scratch folder, which the next session cannot see.

## Delegate with a full brief

A vague brief costs a second round. Give the agent the files and lines, the rules it must
keep, the exact commands to run, what not to touch, and what to report. Run agents in
parallel only when they share no state (one local stack per working tree). If the tool's
own worktree isolation fails, make one with `git worktree add` and hand over its path.
Check the diff before it lands: the report is a claim.

## Ask once

When a decision is the user's, ask early, in one round, every open question together, each
with a recommended option. Default what has a convention and say so in a line.

## Report briefly

What changed, what is verified, what is left, and what needs the user. No replay of the
steps. Under about 150 words unless the user asked for a write-up.
