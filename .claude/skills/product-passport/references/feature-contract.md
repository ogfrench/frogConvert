# Feature contract

**Code is the source, not documentation.** Tests and real execution provide evidence about its behavior. Feature maps are derived navigation aids with no authority to override source. Keep one small entry per meaningful user capability, not per component or function. Prefer code-derived entry points, exact symbol/file paths, and existing test commands. If the map disagrees with code, first determine whether the implementation is wrong or the map stale. Fix bugs in code with a regression; only then refresh the map.

Suggested paths: `docs/product-passport/README.md` for the product-level map and `docs/product-passport/features/<stable-id>.md` for important feature journeys. Other existing product-owned locations can be retained if already canonical.

## Product-level map template

Keep the overview compact and useful to someone entering the repository. Ground every concrete path and capability in inspected code and tests. Include:

1. **Purpose and users:** who uses the product and what outcomes it provides.
2. **Capability map:** grouped user journeys, with entry point, owning source location, and links to detailed feature records where useful. Distinguish implemented, planned, and uninspected.
3. **System map:** UI/CLI/plugin/MCP surfaces; dependencies; where state, persistence, auth, network boundaries, data and artifacts live. Distinguish in-process calls from external integrations.
4. **Validation map:** exact existing test commands, real product journeys, the negative path and host requirements; statuses `passed`, `failed`, `blocked`, or `not_run` tied to revisions when checks were executed.
5. **Maintenance:** last source revision inspected, areas not inspected, and links to the real source, release gates and existing architecture docs.

A first-pass inventory from project documentation is allowed only when labeled `documentation-derived, not source-verified`; it is a starting point, not a Product Passport verification result. Do not allow it to overrule implementation or to claim a supported user journey without proof.

## Feature entry template

```md
# <Feature name>

- **User outcome:** What the user can accomplish.
- **Entry points:** Routes, commands, API/MCP tools, or product interactions.
- **Owner:** Owning UI/module/service and the canonical implementation path.
- **Boundaries:** State, transport, persistence, process, and allowed dependencies.
- **Preconditions:** Inputs, access, runtime requirements, and isolation.
- **Success:** Observable, nontrivial assertions.
- **Failure/recovery:** Important error, empty, permission, or cancellation paths.
- **Verify:** Existing tests and exact runnable task steps.
- **Evidence:** Required output artifacts, source revision, and environment.
- **Known limitations:** Untested hosts or unproven behavior.
```

An entry must be checked against the current source and lead an unfamiliar agent to the correct implementation and a runnable check in minutes. Avoid fixed folder names for UI/client/host: a web app, CLI, research index, and desktop application own behavior differently. Keep both native and plugin/MCP entry points when they materially differ.

## Non-optional upkeep

For each product-facing implementation change or release task, compare changed code paths and user journeys with the existing overview and entries. Update affected map records in the **same PR** after validating the code. For a change without product impact, explicitly note `map unchanged` and why. A missing or inaccessible source is `not inspected`, never silently promoted to verified.

Avoid churn for refactors that leave boundaries and capabilities unchanged, generated files, whitespace and documentation-only edits. The obligation is accuracy, not changing a Markdown file on every commit.

## Change impact

For every changed source path, determine the affected feature and neighboring contract surfaces. Changes to public API, persistence, state synchronization, binary output, permissions, exports, or plugin installation usually require more than a local unit test. If one module supports several features, map their shared invariant once and link from affected entries.

Feature maps are not exhaustive inventories of code symbols and should not duplicate architecture atlases. Prefer generated source-path and command inventories when reliable. A static path-existence check detects drift, not correct behavior; runtime verification remains independent of docs.
