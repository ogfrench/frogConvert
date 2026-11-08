# Verification and adversarial review

## Evaluation design

Capture 20 to 50 task questions **before** tuning retrieval. Mix:
- Exact references: symbol, commit, status flag, source ID, quoted phrase.
- Paraphrases: different wording, synonym and cross-language questions.
- Multi-hop: a decision, rationale, owner and follow-up linked across sources.
- Chronology: changed decisions, stale runbooks, current versus historic status.
- Conflicts: sources disagree on year, denominator, permission, or version.
- Negative: answer absent, restricted source, revoked record, deleted record.
- Attack: source contains "ignore previous instructions", malicious URL, role spoofing, or counterfeit citation.
- Performance: common query, long document, large project, concurrent load.

For each case record query, user/ACL scope, expected source IDs and versions, acceptable alternatives, disallowed answers, evidence anchors and grading reason. Keep client data in the private corpus and use synthetic stand-ins in public tests.

## Required measurements

| Gate | Measure | Failure it catches |
| --- | --- | --- |
| Retrieval recall | recall@1/@5/@10, MRR, per question type | relevant source absent, wrong rank |
| Comparison | keyword-only vs hybrid vs reranked, identical corpus/cases | complexity with no uplift |
| Grounding | cited claims supported by retrieved passages; contradiction surfaced | plausible but unsupported synthesis |
| Abstention | unanswerable and inaccessible queries lead to no answer | confident fabrication or access leak |
| Freshness | updates, reversals and explicit expiry handled | stale "current" answer |
| Safety | revoked role, wrong tenant, deleted file, symlink, traversal | cross-scope leakage |
| Reproducibility | repeat builds + diff, model/version recorded | flaky or stale index |
| Operation | p50/p95 latency, token cost, change-to-index delay | impractical daily use |

**Acceptance should be task-specific.** Do not invent a blanket recall threshold. Six hand-picked exact-ID cases and a green unit suite are only smoke signals, not evidence of agent accuracy.

## Test procedure

1. **Corpus invariants:** index counts, stable IDs, source URLs, metadata, no duplicate generated material, exact links resolved, retained source versions and no missing files.
2. **Write lifecycle:** clean build, no-op refresh, one source changed, source removed, ACL revoked, failed mid-build, rollback and recovery. The old record must not remain queryable.
3. **Retrieval:** run fixed evaluation cases with and without embedding/reranking; compare per-category failures, not just global average.
4. **Security:** cross-project and cross-user retrieval, related-node expansion, path traversal, symlinks, cache mode, debug logs, DNS rebinding / Origin for localhost servers, prompt injection in snippets, secret redaction and provider opt-in.
5. **Answer:** remove the expected source, provide conflicting older/newer records and an attractive malicious source. The answer must abstain or state uncertainty and cite the right source revisions.
6. **Agent task:** run with and without the MCP tools on paired real workflows. Score completion, factual correctness, citation quality, tool cost and unnecessary retrieval. A successful tool call is not a successful task.
7. **Release gate:** document test environment, exact commit, CI run, expected latency, known failures, rollback, provider data processing and whether deployed or only merged.

## Red-team checklist

Ask what an attacker, stale record or mistaken maintainer can exploit. Can an external site query a loopback search server via DNS rebinding? Can a low-trust chunk override the system prompt? Can a canceled decision remain ranked first? Can a revoked document be recalled from the vector table, a cache, a log or cross-project graph edge? Can a user infer a restricted title from result count? Does an unrelated model key silently cause external transmission? Does the source reference point to the exact version quoted?

Treat every "yes" as a bounded defect with a regression test or a release blocker. Document unresolved risks explicitly; don't close an issue by renaming it to "future work".

## Expected outputs for a build task

- Short architecture decision with rejected alternatives and constraints.
- Working ingest, search, get-source, and MCP behavior with citations.
- Deterministic run/reindex commands and honest access/data-flow boundaries.
- Versioned evaluation questions and real results from the actual corpus.
- CI and release notes; owner of refresh, deletion, and rollback.
- Final adversarial review after verification, with severity, observed evidence, and ship/block decision.
