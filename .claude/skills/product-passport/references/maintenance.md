# Maintenance and architecture gardening

Do not rewrite a product because its folders differ from a preferred framework. Preserve the existing stack and authoritative documentation. Dune-inspired principles are one paved path per responsibility, explicit ownership, visible process boundaries, and prevention of recurring workarounds.

## Correction ladder

1. Reproduce the concrete problem and identify its cause.
2. Fix the ownership boundary, state flow, or missing abstraction where that is the cause.
3. Add the narrowest reliable regression test, type constraint, static check, or architecture rule.
4. Update the product-owned feature map, and only then teach a reusable pattern through the existing learning loop.
5. Check the new rule against a legitimate contrasting case, so it does not reward overbroad lint or boilerplate.

Avoid comments that defend short-term solutions or explain away forbidden imports. Preserve mandatory notices and directives. Do not delete established code or introduce broad style bans in a behavior-verification PR.

## Routine

- **On changed features:** inspect map-to-source drift and affected verification paths within the existing PR. Keep the product-level overview and affected feature entries current in the same PR as the implementation, including removals, changed runtime boundaries and supported-host claims.
- **After consequential failures:** examine whether the same class of error could recur in another feature.
- **Periodic read-only audit:** identify stale maps, unreachable checks, duplicated workarounds, and unverifiable claims; create reviewable proposed changes only. Documentation-derived seed maps do not become verified merely by aging or by being present in the repository.
- **Promote reliable checks:** begin advisory; require them in CI only after proving determinism, low false-positive rate, and acceptable cost.

**Completion check:** report `map updated` with paths, `map unchanged` with a product-impact rationale, or `map blocked` with the missing source/tool and a follow-up. This check applies even if the Product Passport skill was not automatically selected. Do not claim tests were run because their commands are listed in a map.

The public shared skill contains no private repository identities, paths, screenshots, secrets, client information, or source excerpts. Store product-specific records in the product repository. Do not centralize private evidence.

## Evaluation

At least one positive, negative, and ambiguous routing case is needed for a new skill. Compare task success with the skill disabled for representative cases. Schema checks and a self-authored demo do not prove agent behavior. Retire overlaps where a proven existing skill already solves the problem.
