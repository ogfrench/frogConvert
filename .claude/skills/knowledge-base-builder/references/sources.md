# Public architecture references and interpretation

- [How We Built Our Knowledge Base](https://www.cerebras.ai/blog/how-we-built-our-knowledge-base), engineering article published July 15, 2026. Public design reference for source-native connectors, a common metadata/index layer, full-text plus semantic retrieval, recency/IDF signals, rank fusion and reranking, code and discussion-specific ingestion, and distinct MCP versus web-agent surfaces.
- [Independent build walkthrough](https://www.youtube.com/watch?v=eCx3SSCcISo), a public video linked by its creator's accompanying post. It describes a small-business implementation inspired by the article and reports an informal before/after question test. Treat this as a motivating demo, **not** independently verified production-quality evidence.
- [Cerebras blog index](https://www.cerebras.ai/blog) confirms the article title and publication date. Some web clients cannot fetch the full interactive article or the video's transcript. The design described here is cross-checked against public summaries and examples; **do not claim a word-for-word video review** if the transcript has not been obtained.

## What to reuse, what to question

Reuse the narrow common ingest schema, native source ownership, per-source metadata, hybrid retrieval, context expansion and separate LLM-free retrieval tools for agents. Test each layer, because adding semantic search, reranking and synthetic summaries may degrade exact lookup or reliability.

Do not copy the reported production stack blindly. Large-scale streaming ingestion, continuously updated chat threads, heavy rerankers and Postgres vector infrastructure solve problems a single local repository may not have. Reported usage volume is **adoption**, not proof of correctness. Public write-ups do not establish that authorization, deletion propagation, citation faithfulness, drift and cost are solved. Verify each in the implementation.

A frequent unspoken failure is a **reversed decision**: boosting newer text is helpful, but neither age nor authority proves which record is currently valid. Make supersession explicit and test it.
