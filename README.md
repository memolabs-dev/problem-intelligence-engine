# Problem Intelligence Engine

Evidence-first problem discovery. Local research engine; **not production-ready**.

## Run

Node.js 20+, PostgreSQL for live ingestion/evaluation.

```bash
npm test
node packages/ingestion/run.mjs
node packages/agents/run.mjs
node packages/agents/evaluate.mjs
```

The deterministic extractor creates *unverified candidates* linked to raw source observations. Counts of candidates are not counts of independent users or verified opportunities.

## LLM extraction and verification

The model layer calls OpenAI-compatible chat completions. Configure a provider in `.env` (gitignored); check availability without printing its secret:

```bash
npm run llm:check
```

For the currently validated **free** Nemotron endpoint via OpenRouter:

```bash
PIE_LLM_BATCH_LIMIT=15 npm run llm:verified
node packages/agents/evaluate-llm.mjs llm-batch-report.json
```

`llm:verified` deliberately overrides the configured model with `nvidia/nemotron-3.5-lightning:free` and performs two stages:

1. Extraction using a numbered evidence passage from the observation. The application resolves evidence IDs to **exact source text**; fabricated quotes are rejected. Nemotron is forced to call a structured `submit_extraction` tool rather than emitting free-form JSON. Its requests omit unsupported `response_format` and request no reasoning tokens. Qualification likewise uses a structured `submit_verdict` tool.
2. Independent qualification of the candidate against the source. Reports preserve `found`, `rejected`, `none`, and `error` separately. Model failures are **not** counted as negative classifications.

`llm:batch` is still available to run raw extraction without the reviewer. Batch options: `PIE_LLM_BATCH_LIMIT`, `PIE_LLM_OBSERVATION_IDS`, `PIE_LLM_REPORT_PATH`. Set `PIE_LLM_VERIFY=1` to add verification to a batch.

Free endpoints can be rate-limited. The default process-local gap between OpenRouter calls is 3.3 seconds (override with `PIE_LLM_MIN_INTERVAL_MS`); HTTP 429 responses receive a bounded backoff and retry. Network/model errors remain errors, not negative predictions. Requests and reports may contain excerpts from public posts. Local experiment reports are excluded from version control.

## Evaluation caveats

`eval/labels.json` contains a **small, development-influenced** set of manually chosen labels from the current 15 observations. `eval/needs-review.json` excludes ambiguous examples pending independent annotation. Results from this data are diagnostic only; they are **not generalization estimates**.

Use `node packages/agents/evaluate-llm.mjs <report.json>` to measure precision, recall, F1, and coverage. Improvement must be confirmed on a larger, independently annotated holdout from diverse sources before deployment.

## Security

Treat feedback as hostile, untrusted input. Only HTTPS model endpoints are permitted, paid OpenRouter models are blocked in these runners, and API key values are never logged. Do not commit a filled `.env` or generated model reports.

## Balanced discovery and durable evidence

Initialize or upgrade the local schema safely (additive `CREATE TABLE IF NOT EXISTS` and column changes only):

```bash
npm run db:migrate
```

To evaluate a reproducible, source-balanced sample that includes observations missed by lexical heuristics:

```bash
PIE_LLM_SELECTION=balanced PIE_LLM_BATCH_LIMIT=20 npm run llm:verified
```

The default balanced sampler reserves 30% of the selected observations for exploration. The remaining 70% are heuristic signals. Source groups are GitHub repositories and Hacker News; selection is deterministic for a given corpus. Use `PIE_LLM_EXPLORATION_FRACTION` to adjust the split.

An optional **hybrid recovery** catches failed LLM output validation (not HTTP errors):

```bash
PIE_LLM_SELECTION=balanced PIE_LLM_FALLBACK=heuristic PIE_LLM_BATCH_LIMIT=20 npm run llm:verified
```

Recovered candidates carry `recovery.kind=heuristic_fallback` and `candidate.method=heuristic-v2` and **must still pass the independent verifier**. They are never silently presented as successful LLM extractions.

Every verified batch contains an `evidenceGraph`. It only links candidates whose quoted evidence is found verbatim in the current source observation, groups near duplicates, and distinguishes source documents from identified accounts. Multiple posts do **not** prove independent people, validated demand, willingness to pay, or product-market fit.

Rebuild a graph from a previously saved verified report without making model calls:

```bash
npm run llm:graph -- /tmp/pie-balanced-20.json /tmp/pie-balanced-20-graph.json
```

Archive the outcome in PostgreSQL without overwriting earlier heuristic problems or earlier model runs:

```bash
npm run llm:import -- /tmp/pie-balanced-20.json openrouter nvidia/nemotron-3.5-lightning:free
```

This creates a `model_runs` entry and one `model_decisions` entry per source observation. The source content hash is snapshotted so later edits can be detected; importing the same unchanged report again is idempotent. Failed and rejected decisions are recorded as such and never promoted into evidence. Market validation is always `unknown` until independently investigated.

The current sample is not a representative measure of the market. **Precision/recall against the development labels must not be compared to a new corpus without independently annotating the new examples.**

## Corroboration Engine (P0, experimental)

There are **two different questions**:
- Does a source make a concrete, quote-supported claim?
- Does another distinct discussion describe the **same underlying difficulty**?

Neither one proves willingness to pay.

Local infrastructure uses PostgreSQL + pgvector 0.8.x and free Ollama `all-minilm` embeddings (384 dimensions). One-time setup on Mac:

```bash
npm run db:migrate
ollama serve                 # run only if Ollama is not already running
ollama pull all-minilm       # 45 MB; local, no embedding API fees
npm run embeddings:run
```

To collect the *actual replies* to selected public GitHub issues and Hacker News stories:

```bash
PIE_THREAD_IDS='hackernews:49972125,github:5797400999' PIE_REPLIES_PER_THREAD=15 npm run threads:ingest
```

Each reply retains its **root discussion ID**, **parent message ID**, **content hash**, source URL and a per-platform hashed account key. Raw account names are not stored in the conversation tables. Hashed accounts are pseudonymous, *not* anonymous, and do not prove distinct humans. The fetch is intentionally bounded; `capped=true` means only part of a discussion was retrieved.

To verify whether comments *personally report the same difficulty*:

```bash
PIE_LLM_PROVIDER=openrouter PIE_LLM_MODEL=nvidia/nemotron-3.5-lightning:free npm run threads:review
```

The checker distinguishes firsthand experience, mere agreement, unrelated reports, irrelevant replies and uncertainty. An additional explicit-experience gate demotes suggestions and links to `uncertain`; this favors precision over recall. Old decisions can be rechecked without LLM calls:

```bash
PIE_COMMENT_AUDIT=1 npm run threads:review
```

Multiple replies by one account count once; multiple accounts in **one thread** are *not multiple independent discussions* and do not establish market demand.

To retrieve vector-nearest candidate pairs and have Nemotron decide if they are truly equivalent:

```bash
PIE_LLM_PROVIDER=openrouter PIE_LLM_MODEL=nvidia/nemotron-3.5-lightning:free npm run corroboration:run
```

`PIE_SIMILARITY_THRESHOLD` defaults to `0.40`, `PIE_PAIR_LIMIT` to `12`. The similarity threshold only selects **candidates**; it never automatically merges them. A merge requires an explicit `same_problem` verdict from the semantic reviewer. Clustering uses **complete-link** semantics, preventing transitive false merges. Previously reviewed pairs are reused instead of paying for additional LLM calls. Results retain all unpaired problems as singletons.

For a small **synthetic development test**, not an independent accuracy study:

```bash
PIE_LLM_PROVIDER=openrouter PIE_LLM_MODEL=nvidia/nemotron-3.5-lightning:free npm run corroboration:evaluate
```

The corpus for evaluation lives in `eval/corroboration-pairs.json`. It mixes paraphrases and hard negatives within the same software stack. Its labels were created during development, so scores **must not be marketed as generalizable precision or recall**.

### Present limits

- Current candidate retrieval does a bounded, database-side pair comparison. The pgvector HNSW index is available, but scalable KNN retrieval for large archives is still future work.
- Source-account keys must not be mistaken for verified human identities. Distinct posts may be reposts or copied content.
- Firsthand reply classifiers still require a human-labeled evaluation corpus. Until then they are model-screened signals, not validated demand.
- The system currently distinguishes candidate recurrence and commentary, but does not infer *purchase intent* from volume.
- Corrections to source content invalidate the matching stored source fingerprint; rerun extraction rather than reusing a stale claim.
