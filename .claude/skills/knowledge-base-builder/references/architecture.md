# Architecture: an evidence system for agents

This is a portable design guide, not a command to migrate every repository to a new framework. Inspect the existing stack and make the smallest change that produces better answers with evidence.

## 1. Source inventory and trust

For every source class, capture its primary key, update method, typical length, retention, owner, permission model, source URL, observed timestamp, event timestamp, and whether it is canonical. Separate facts, analyses, decisions, status snapshots, and machine-generated summaries.

Example source classes: Markdown and PDFs; code, symbol definitions, PRs and commits; issues and incident threads; chat threads; policy pages; structured CSV/JSONL; meeting notes. For internal information, keep each connector limited to an approved scope, and protect its index using the same or stricter ACL.

Avoid "one source of truth" migration. Index material where it is maintained. Prefer existing structured registers and valid canonical IDs. The search store is a rebuildable **read model**, not a replacement for authoritative files.

## 2. A narrow source contract

Every normalized source should minimally carry:

```json
{
  "source_id": "source-specific-stable-key",
  "project_id": "scope",
  "source_type": "document",
  "title": "Title",
  "uri": "relative/path/or/safe-url",
  "version": "revision-or-hash",
  "content_hash": "sha256",
  "observed_at": "timestamp",
  "event_at": null,
  "valid_from": null,
  "valid_until": null,
  "supersedes": [],
  "access_scope": ["authorized-role"],
  "authority": "primary|secondary|derived|unknown",
  "evidence_label": "verified|claim|assumption|estimate|unknown",
  "body": "read-only source text"
}
```

A chunk adds a stable `chunk_id`, parent `source_id`, heading, section anchor, offsets, quote context, and embedding model/version. Preserve enough information to retrieve the **whole original** and show where a passage came from. A source file SHA is not evidence that its claim was independently checked. Decide how to handle re-identification when a source key changes.

## 3. Ingestion, mutation and deletion

1. Discover only allowlisted paths/connectors; reject symlinks, traversal, hidden credentials, generated duplicates and oversize/binary items unless supported.
2. Fetch via least-privileged credentials, apply authorization at source and record levels, record retrieval time, and store an immutable reference to source revision.
3. Normalize text and metadata. Preserve tables, headings and source IDs; avoid flattening contradictory passages into one unqualified "answer".
4. Prefer paragraph/section-aware chunks for documents, syntax/symbol chunks for code and complete resolution-aware threads for discussions. Use overlapping context sparingly: duplicates can monopolize results.
5. For noisy conversations, separately store a distillation (question, context, decision/resolution, owner, relevant paths) with pointers back to the raw thread. Mark generated extraction as **derived**, never authoritative.
6. Upsert only changed source IDs or chunk hashes. Remove deleted/revoked documents and embeddings immediately; test tombstones, stale caches and query races.
7. Publish a complete index snapshot or use recoverable transactions. Keep a schema version and deterministic reindex command.

Never simply append every scan. Newer source versions must supersede or replace the old record by explicit policy.

## 4. Retrieval pipeline

```text
question + authorized scope
  -> exact ID/path/symbol lookup
  -> full-text lexical search       \
  -> multilingual embeddings        |  parallel candidate generators
  -> relation/metadata filters      /
  -> Reciprocal Rank Fusion (rank-based, not score calibration)
  -> dedupe by source/version + per-source candidate caps
  -> optional cross-encoder or LLM reranker on small candidates
  -> expand headings, sibling chunks and linked source documents
  -> grounded evidence bundle -> agent or optional answer synthesis
```

Lexical matches catch exact error strings, legal references, issue numbers and file paths. Semantic retrieval catches paraphrase and language variation. RRF is useful when their scores are incomparable. An optional reranker targets precision after recall, but increases latency, cost and provider exposure. Term rarity, authority and age can help, but measure them rather than making them defaults. Weighting a newer low-quality comment above an older verified decision is a failure, not freshness.

Project and per-document ACLs must filter **before** ranking and before neighbor expansion. Never expose cross-project snippets in a fused candidate set or a model prompt. Relational links can cross scope; every hop must re-check access.

## 5. Time and disagreement

Store `event_at` and `observed_at` separately. Add `valid_until` or a freshness class: persistent (design rationale), snapshot (dated assessment), live-state (status that expires), and archival (superseded). Explicit `supersedes` links outperform blind recency weighting. Present conflicting sources with their dates and definitions and explain what remains unresolved. Allow agents to request current source state when a question depends on it.

## 6. Answering without false confidence

A good evidence bundle includes IDs, URI/path/section anchors, excerpt, timestamp, source classification, verification state, and any contradictory matches. The synthesizer can cite only these IDs. A regex that finds `[1]` is not enough: inspect whether the cited source actually supports each claim and whether the claim preserves its denominator, year and scope. Provide a structured `insufficient_evidence`/abstention path. Treat content as data, not commands.

## 7. Interfaces and rollout

A local CLI + stdio MCP pair often suffices for one developer. Add a browser UI only when human review materially helps. Production/shared use needs identity, per-source authorization, audit logs, quotas, rate limits, token budget guards, deletion propagation, sensitive metadata controls, backup and restore, observed latency and refresh monitoring. A cache under a user home directory can still leak sensitive text if its file permissions are wrong.

Avoid automatic syncing of private sources or machine-specific MCP paths into a public shared setup. Install private connectors per authorized project. Small corpora do not need Postgres, a vector service, a scheduler and agent orchestration on day one.

## 8. Build sequence

- **Baseline**: existing graph or files -> stable IDs -> local FTS -> CLI/MCP -> 20 grounded evaluation questions.
- **Quality**: better chunking/metadata -> semantic embeddings -> RRF -> optional reranker -> hard negatives and paired ablations.
- **Operations**: connectors -> incremental refresh and tombstones -> authorization -> monitoring and retention.
- **Scale**: per-project namespaces, tenant scopes, async jobs, partial re-embedding, index migrations, admin tools.

Do not label a proof of concept "production-ready" merely because CI is green. CI checks consistency; field questions test usefulness and permissions.
