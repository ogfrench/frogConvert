# Test reliability, environments and execution

- Use disposable fixtures, unique ports, test DBs, isolated browser profiles,
  controlled clocks and clean services. Never direct destructive tests at production.
- Wait for observable readiness and assert the running process and revision.
  A fixed sleep can hide startup races and should not prove correctness.
- To test races, force order with barriers at real read/write boundaries; confirm
  the losing actor cannot perform the forbidden action.
- Mock external systems outside the behavior under test, not the very persistence,
  serializer or protocol that a test claims to verify.
- On flakes, preserve traces, logs, screenshots and event chronology; minimize and
  fix the race or shared state. Repeated green retries do not erase a red result.
- Record revision, environment, input, assertion and artifact for each proof.
  Rerun invalidated required checks on the final head after material code changes.
- Deployment smoke is separate from source, CI, visual, install and host acceptance.
