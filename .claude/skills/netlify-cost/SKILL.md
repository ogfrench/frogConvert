---
name: netlify-cost
description: >-
  Estimate Netlify cost before changing its config or build.
---

# Netlify bills by plan, so find the plan first

Two pricing models exist, and the same site costs different things on each. Prices below
were read on 2026-10-18 from Netlify's docs; check them before quoting.

- **Legacy plans** (accounts made before 2025-09-04): Pro includes 25,000 build minutes, 1 TB
  bandwidth and 2 million edge function runs a month, with overage per block.
- **Credit plans** (newer accounts, or one that switched; switching is permanent): Pro is
  $20 for 3,000 credits. A production deploy is 15 credits, a Deploy Preview is free, build
  minutes are not metered, bandwidth is 20 credits a GB, and 10,000 requests are 2 credits,
  edge function runs included. At zero credits every site on the team goes down.

The team's Plan details page says which one. Ask the owner, and say which you assumed.

## Estimate a month before changing anything

1. **Builds:** deploys a week x 4.3 x minutes a deploy. Production deploys are merges to the
   default branch; previews are pushes to open pull requests. Count them from the Git host,
   since the read-only API has no deploy list; read the minutes from a few deploys.
2. **Credits (credit plan):** production deploys x 15 + GB x 20 + requests / 10,000 x 2. For
   a site with many merges a day, deploys are nearly all of it.
3. **Edge runs and bandwidth:** from the observability tools (below). A new edge function
   path multiplies runs by every request it matches; a new image is paid for on every view.
4. **Say the number** against the allowance before merging.

## Cheap defaults

- **Skip a build that cannot change the site.** An `ignore` command in `netlify.toml` exits 0
  to skip and 1 to build, and its path must start with `./`. Skip only when every changed
  file is on an explicit list of files the build never reads, and build when unsure. The
  textbook `git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF` skips a first build: with no
  cache Netlify sets the cached ref to the commit itself, so the diff is empty. Also diff
  the commit against its first parent, because a cached ref can be a pull request's head.
  Test the script, and test that nothing on its list is read by the build.
- **Batch merges** on a credit plan: each merge to the default branch is a billed deploy.
  Open pull requests as drafts and mark them ready once local checks pass.
- **Keep a login gate complete.** An edge function gate must run on every private path,
  assets included. `excludedPath` is safe only for paths the gate already serves to
  anyone, and a test should fail if the two lists differ. Never exclude a path to save runs.
- **Long cache headers on content-hashed files**; no new functions or stores for work a
  nightly job can do.
- **Draft pull requests cannot be skipped from the build:** Netlify exposes `PULL_REQUEST`
  and `REVIEW_ID`, no draft flag. Asking the Git host's API needs a token in the build.
- **Settings are the owner's** (Deploy Previews, branch deploys, auto recharge, plan). Write
  the setting's place in the UI and its trade-off; do not change it.

## Reading usage, read only

Load the Netlify MCP readers with ToolSearch (project, deploy, team, observability); never
an updater. `get-deploy` gives `deploy_time` in seconds, `context` and the commit; deploy ids
are in a commit's check runs. Observability `get-topk` (`edge_functions`, `urls`, sort by
`EdgeFunctionInvocations` or `Bandwidth`) and `get-timeseries` take millisecond times; Pro
keeps 7 days. The plan type, billed spend and deploy counts are not in these tools.
