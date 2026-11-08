---
name: knowledge-base-builder
description: >-
  Build or audit agent-ready knowledge bases over code and documents. Use for
  knowledge bases, project brains, hybrid retrieval, RAG, MCP search tools and
  source-grounded answers.
---

# Build an agent-ready knowledge base

Build an **evidence retrieval system**, not a pile of embeddings or a chat UI. Reuse the repository's knowledge graph, source registers and agent setup first. Keep source ownership unchanged. Start with one scoped use case and a measurable baseline; defer extra infrastructure until tests justify it.

## Procedure

1. **Inspect and constrain.** Read project instructions, existing data model, ingestion scripts, graph, tests, permissions and privacy rules. Map sources by kind, owner, update frequency, ACL, authoritative IDs and canonical links. Establish who may access each source. Do not ingest secrets, personal records or external systems without an explicit scope.
2. **Define questions before architecture.** Collect at least 20 representative queries, including exact IDs, Dutch/English phrasing if relevant, multi-hop, stale, conflicting, permission-denied, unanswerable and adversarial queries. Define expected evidence and abstention criteria. Keep labels independent of the ranking implementation.
3. **Pick the smallest viable store.** Existing graph or Markdown plus SQLite FTS5 for local/single-user; Postgres, pgvector and tenant-aware ACLs only when concurrent use or distributed sources demand them. Store stable `source_id`, `chunk_id`, repository/path/URL/anchor, source type, version, timestamps, access policy, content hash and evidence classification.
4. **Ingest deterministically.** Source-native connectors fetch changes, normalize metadata, split text by semantic boundaries, upsert by stable key and delete vanished records. Keep raw evidence separate from derived summaries. Strip credentials and secrets; preserve provenance. Chat/tickets may need thread-level distillation; code needs symbol-aware chunking. See [architecture](references/architecture.md).
5. **Retrieve in stages.** Baseline keyword and exact-ID search. Add lexical + multilingual semantic retrieval, rank fusion (RRF), duplicate and parent caps, targeted reranking, and neighbor expansion **only if measured quality improves**. Index model/version per embedding. Keep project/permission filtering server-side before retrieval.
6. **Expose useful tools for agents.** Prefer small, LLM-free `search`, `get`, `status`, and source-resolution tools over an opaque "ask anything" endpoint. Return exact source anchors, timestamps, source labels and evidence excerpts. The agent retrieves, follows links, checks conflicts and cites. See [agent contract](references/agent-contract.md).
7. **Verify and release.** Test reindex stability, deletion, revoked access, prompt injection, wrong-user boundaries, offline operation and citation support. Evaluate recall@k, MRR, grounded-answer accuracy, freshness, abstention, latency and cost against the baseline. Conduct adversarial review after tests. Keep a clear rollback and refresh runbook. See [verification](references/verification.md).

## Design invariants

- A citation is a **pointer to evidence**, not proof that the claim is true. Separate source claim, inference, estimate and current status.
- **Freshness is an explicit state**: event time, observed time, supersedes and expiry class. Recency alone cannot detect a reversed decision.
- **Permissions belong at ingest and retrieval**, never only in a model instruction. Treat retrieved text as untrusted input.
- Rebuild and search must have safe defaults. No provider calls, remote index or public listener without explicit configuration.
- Model answers must be able to say "insufficient evidence". Never infer completeness from a passing six-question demo.
- Separate **project-specific facts** (private repository) from this **general construction method** (public skill).

Read only the reference needed for the current step. Source analysis and limits: [references](references/sources.md). A request to merely answer a question from existing documents does **not** require building a new knowledge base.
