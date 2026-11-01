---
name: learning-loop
description: >-
  Capture and promote reusable lessons into skills and best practices. Use
  after bugs, tool quirks, corrections and milestones, or when asked to
  remember a lesson, make a skill, promote a learning or harvest learnings.
---

# Learning loop

```
learning (raw) -> practice (curated) -> promoted (skill, agent, hook, command, plugin...) -> retired
```

The record lives in `ogfrench/claude-code-setup`: raw notes in `learnings/`, curated
practices in the `best-practices` skill, and the promotion ladder in that repo's
`CLAUDE.md`. **That repo is public, and this is a hard rule:** no client names or real
brands, nothing from a private repo (not even its name), no employer-confidential work, no
secrets, hostnames, IPs, emails or people. Write the lesson so it stands on its own. In a
private repo, `source` is "a private project" and the evidence names no file, commit or
issue from it.

## Capture, from any repo

**Worth a learning:** something cost real time; a review or a test found a class of bug,
not just a bug; a tool behaved unlike its docs; the user corrected the approach; a guess
turned out wrong. **Not worth one:** a fact about one repo (that goes in its `CLAUDE.md`),
or anything already a practice.

1. Write it with the template in `learnings/README.md`: a one-line lesson, then What
   happened, Why, Do instead, Evidence. One idea per file, `status: raw`. In the repo,
   `node scripts/kb-new.mjs learning <slug>` creates the file; `node --test` rejects it
   until every `TODO` is written.
2. **Where:**
   - If the lesson cannot be told without a client, a private repo or a person, it is
     private. Write it to the user's private notes repo if one is attached to the session
     (same template), else to the current repo's `CLAUDE.md` if it only holds there, else
     ask the user. It never goes to `claude-code-setup` until it is rewritten without names.
   - If `claude-code-setup` is cloned or can be attached to the session, run
     `git config core.hooksPath .githooks` in it, add `learnings/YYYY-MM-DD-slug.md`,
     run `node --test` and `node scripts/check-public.mjs`, commit on a branch and open a
     pull request titled "Learning: <the lesson>". Never push to `main`.
   - If it cannot be attached, append the same text to `.claude/learnings-inbox.md` in
     the current repo, and tell the user it is waiting to be harvested.
3. Say in one line what was captured, and where.

## Curate, in claude-code-setup

1. Look for a practice it extends: `grep -i <term> kb/index.jsonl`. Extend that node, add the
   learning to its `derived_from`, and bump `last_verified`. No near-duplicates.
2. Otherwise add `kb/practices/<id>.md`. Copy a neighbor: `summary` (one line, max 140 chars),
   `concern` and `stack` from `kb/_vocab.json` (`any` unless the lesson holds on one stack
   alone), `severity` (`must`, `should`, `tip`), `derived_from`,
   then the reason as the body. Keep the card under 150 tokens.
3. Run `node scripts/build-kb.mjs`. It rewrites the topic files, bundles and index. Never edit those.
4. Set the learning to `status: practice` with the topic file in `promoted_to`.
5. A learning that only holds in one repo goes to that repo's `CLAUDE.md` instead.

## Evaluate and prune before promotion

Before adding a new skill or subagent, record at least three representative cases:
one that should trigger it, one that should not, and an ambiguous or regression
case. Compare task completion and routing with the component disabled. A static
schema check cannot prove model behavior. Store cases with the component or a
shared evaluation set. Consolidate overlapping specialist prompts into skills
or tools when the results hold; retain a subagent for measured isolation,
independent review or parallel execution. Retire unused pieces on evidence.

## Promote

Use the ladder in the repo's `CLAUDE.md`, and pick the lightest form that works:

- **Skill:** a procedure with steps, triggered by a kind of task.
- **Hook:** must always hold, and a script can check it.
- **Subagent:** a recurring delegated role with its own prompt and model.
- **Slash command:** a recurring prompt started by name.
- **Plugin:** two or more related pieces, enabled as a unit.
- **MCP server:** needs a live outside system.

Then add the files where the README's Layout table says, and a node in `kb/tools/` for a new
skill, agent, plugin or MCP server. Update the plugin's `plugin.json`,
`.claude-plugin/marketplace.json` and the README's Plugins table if a plugin is new. Set the
learning to `status: promoted` and list every path in `promoted_to`. Check with
`node --test` and `claude plugin validate . --strict` before opening the PR.

## Harvest

For each repo in `repos.local.txt` (on the laptop, never committed), read its
`.claude/learnings-inbox.md` (a shallow clone, or the GitHub API). An inbox in a private repo
is written freely, so scrub every entry for the public repo before it becomes a learning
here: no names, no paths, no quotes. Run `node scripts/check-public.mjs` before committing,
then empty that inbox with a commit in its repo.

## Retire

A practice that stopped being true, or that a tool now handles, gets `status: retired` (or
`stale` while unverified), which drops it from the topic files and bundles on the next build.
Its learning stays, with `status: retired` and a line saying why.
