---
name: rag
description: Retrieval-augmented generation covering ingestion, chunking, embeddings, hybrid
  search, reranking, citations, and retrieval evaluation. Use when building or changing a RAG
  pipeline, tuning chunking or top-k, or debugging poorly grounded answers. Do not use for general
  LLM evaluation without retrieval changes; use llm-evals instead.
---

# rag

Retrieval and generation are separate problems. Most failures blamed on the model are retrieval
failures: the correct passage never reached the context.

**If you do not measure retrieval separately, you are debugging blindly.** Before touching the
prompt, check whether a passage containing the answer was among the retrieved results. If it was
not, the prompt is not the problem.

## Diagnose before tuning

1. Does the fact exist in the corpus? If not, the pipeline works; content is missing.
2. Was the correct passage retrieved? If not, it is a **retrieval** problem.
3. Retrieved but ignored by the model? A **generation or ordering** problem.
4. Retrieved, used, still wrong? A **prompt** problem.

Jumping to step 4 without checking step 2 is the most common way to lose an afternoon.

## Ingestion

- **Document identity matters.** A stable ID enables deduplication, reindexing and deletion.
  Without one, reingestion silently duplicates the corpus.
- **Version the index.** When chunking or the embedding model changes the old index is
  incompatible. Reindex everything; never mix versions.
- **Parsing is half the work.** Flattening a two-column PDF into one stream destroys retrieval, and
  embedding metrics will not reveal the cause.
- **Retain metadata** — source, section, date, permissions. Filtering later is impossible if it was
  never stored.

## Chunking

No universal size. One rule: **a chunk must make sense on its own.**

- Split by structure — heading, section, function — before character count.
- Enough overlap not to cut a sentence in half; excessive overlap inflates the index without
  improving retrieval.
- Prefix the chunk with document and section titles. A chunk starting "In addition, the limit is 30
  days" does not identify its subject.
- Very small chunks retrieve well but answer poorly; very large ones do the reverse. When unsure,
  test two sizes and measure.

## Retrieval

- **Hybrid by default.** Vector search alone misses proper names, error codes and acronyms; lexical
  search like BM25 misses paraphrases. Combined usually beats either.
- **Metadata filters before raising top-k.** If the answer is in this year's documents for one
  client, filter first; retrieving 50 chunks to keep three wastes everything.
- **Reranking** when precision matters: retrieve 50, reorder with a cross-encoder, pass five. Often
  the best quality-to-effort ratio in the pipeline.
- Do not raise **top-k "just in case"** — more context is more cost, latency and distracting noise.

## Citations and grounding

- Cite the **specific evidence passage**, not just the document. "It is in the manual" is not a
  citation.
- Make any claim not supported by a retrieved chunk visibly distinct. If the system can answer
  without retrieval, label that answer or withhold it.
- Keep citation format stable and testable; a format that varies with model output cannot be
  verified.

## Evaluation

A small query set with expected answers beats intuition.

| Metric | Meaning |
|---|---|
| recall@k | Was the correct passage among the k retrieved? The baseline metric |
| precision@k | How much noise came with it |
| MRR | How high the correct passage ranked |
| grounding | Is every claim supported by a cited passage? |

**Measure before and after every change.** A chunking or top-k adjustment without measurement is a
bet. "It seems better" is not a result.

## Anti-patterns

- Changing chunking without reindexing, leaving inconsistent data and random symptoms.
- Evaluating answer style rather than grounding.
- Silently falling back to model knowledge while presenting the answer as source-backed.
- Raising top-k to conceal poor retrieval.
- Storing a chunk without source metadata, making citation, filtering and deletion impossible.
- Reingesting without deduplication until four copies compete with each other.

## Verification

- Run the query set before and after the change and retain the metrics.
- Test one no-result case and one contradictory-results case; inspect the behavior.
- Read the evidence and verify citations actually support each claim.
- Recheck citations after retrieval changes; they break without warning.
