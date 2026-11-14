# Production readiness and recovery

Use for risky deployments, migrations, releases and user-impacting operational
changes. This extends delivery-loop; it is not a separate release manager.

Before deployment:
- Identify immutable build/release SHA and actual deploy target. Recheck
  required CI and source-to-artifact correspondence on that revision.
- Verify config, secrets, feature flags, data dependencies, permissions,
  external services, observability and on-call/owner coverage.
- For migrations, check forwards/backwards compatibility, lock duration,
  rollback feasibility and behavior of old and new app versions.
- Test backup *restoration*, not merely existence. State destructive steps
  and which rollback can preserve writes made after release.
- Prepare a scoped smoke journey and explicit rollback/stop criteria.

During and after:
- Distinguish GitHub merge, built artifact, published release, deployed revision
  and production verification. No one status implies the next.
- Inspect logs, SLO-relevant errors and a real synthetic success/negative task.
- For an incident, limit the blast radius, preserve evidence, restore service
  safely, then reconcile production state, outstanding data and customer effects.
- Record exact revisions, timestamps, checks, rollback state and remaining risks.
  Never say production is verified when no authorized host probe ran.
