# Problem Intelligence Engine

**A [Memo Labs Dev](https://github.com/memolabs-dev) product** · [Source repository](https://github.com/memolabs-dev/problem-intelligence-engine)

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

## Targeted recurrence research

A verified problem is now a **starting point for further research**, not a declaration of market demand.

Search the existing local verified problem archive by meaning (Ollama embeddings + pgvector KNN):

```bash
npm run problems:search -- "Turbopack fails to preserve names on dynamic import chunks"
```

The returned similarity is a retrieval score, not a semantic-equivalence verdict. Every result preserves its source URL and exact recorded evidence; `sameUnderlyingProblem` stays `not_reviewed`.

Explore **new public source observations** with GitHub issue search and Hacker News Algolia story search:

```bash
PIE_DISCOVERY_PER_SOURCE=8 npm run discover:search -- "turbopack webpackChunkName"
```

The search is bounded (1–40 results per source), never scrapes gated content, and preserves failures from either provider. It saves results as **unverified raw observations** for subsequent extraction and review; no hit becomes a verified problem automatically. A search is auditable through `targeted_search_runs` and `targeted_search_hits`, including the original query and content hashes.

The report distinguishes `uniqueObservations`, `distinctSourceAccounts` and `repeatedPostsFromKnownAccounts`. Different platform accounts do not prove different people; `verifiedIndependentHumans` remains unknown.

**Example caution:** two nearly identical GitHub issues about `webpackChunkName` were filed by the same source account. They are two posts, not two confirmed independent users. A different issue about a bundler is a search hit, not necessarily the same problem.

After targeted discovery, choose the new observation IDs for `PIE_LLM_OBSERVATION_IDS`, run `npm run llm:verified`, import the verified report and run `npm run embeddings:run`. Only then may the corroboration reviewer assess whether different threads refer to an equivalent problem.

## Memo Labs Dev development workflow

The canonical home of this product is **[memolabs-dev/problem-intelligence-engine](https://github.com/memolabs-dev/problem-intelligence-engine)**.

The organization contributor account is [`drop-agent-bot`](https://github.com/drop-agent-bot), with repository-level **write** permissions (not admin). The account is shared with Drop and CUESHEET; its name is retained until an organization-wide bot rename is planned. Agents develop on branches and submit PRs, with **automatic merge once both required CI checks pass** in the current solo-maintainer setup. [`CODEOWNERS`](.github/CODEOWNERS) records future maintainers, but approval is not currently mandatory. CI runs Node.js 22/24 and PostgreSQL/pgvector checks. Never store bot tokens in this repository.

## End-to-end targeted discovery cycle (experimental)

A new single command performs public discovery and evaluates only **new or source-changed** observations:

```bash
PIE_DISCOVERY_PER_SOURCE=8 PIE_DISCOVERY_MAX_ANALYZE=6 \
  npm run discovery:cycle -- "turbopack webpackChunkName"
```

Stages:
1. Search public GitHub issues and Hacker News stories; record the search run, content hashes, and account pseudonyms.
2. Compare hits to the latest *completed* source-backed decision. Skip unchanged observations already marked `found`, `rejected`, or `none`. Retry prior `error` decisions.
3. Run bounded Nemotron extraction and an independent source-evidence verifier only on the pending observations.
4. Archive found/rejected/none/error decisions in PostgreSQL; compute local pgvector embeddings for verified findings.
5. Consider only vector-nearest pairs touching newly verified observations, and ask the semantic reviewer to determine whether they express the same underlying problem.

`PIE_DISCOVERY_MAX_ANALYZE` has a hard maximum of 20; `PIE_DISCOVERY_MAX_PAIRS` of 30. Paid OpenRouter model names are rejected. The report distinguishes source repetition from actual independent demand, which remains **unknown** even if equivalent posts are found.

Running the same query again after all hits are reviewed will not call the LLM again unless the source content changes. The search itself still fetches current public results to detect changes.

**Not a commercial validation service yet:** a recurrent technical issue may still have no market, willingness to pay, or viable solution.

## Evidence dossier (local, read-only)

Once two posts are semantically related, the maintainer can inspect a **source-grounded dossier**, with no further inference API calls:

```bash
npm run problems:dossier -- github:5814924941
```

The dossier includes the original verified quote, related corroboration edges, URLs and the reviewer's rationale. It explicitly distinguishes **two reports from the same account** from independent reporter accounts. It never claims verified distinct humans or a commercially validated opportunity. Discussion support is only shown when the original quote remains present verbatim in the current comment.

## Resumable public conversations (P0)

Thread ingestion now supports **bounded, crash-safe pagination** for public GitHub issue comments and Hacker News reply trees. Each invocation processes **at most 100 examined comments per thread**, not necessarily 100 accepted messages; deleted/empty replies consume budget. A PostgreSQL checkpoint records the next GitHub page/offset or the Hacker News BFS queue and seen IDs.

```bash
PIE_THREAD_IDS='hackernews:49972125' PIE_REPLIES_PER_THREAD=25 npm run threads:ingest
# Run the same command again to continue a partial conversation.
```

Results distinguish `partial`, `complete` and `error`, and show `resumed`, `processed`, `replies`, and `capped`. The checkpoint and source messages commit atomically. A failed fetch keeps the last committed cursor; retries are bounded and recognize HTTP 429/502/503/504, including `Retry-After`. Completed discussions are skipped until an explicit refresh:

```bash
PIE_THREADS_REFRESH=1 PIE_THREAD_IDS='hackernews:49972125' npm run threads:ingest
```

GitHub loads a fixed 100-comment page and stores the offset into that page, while HN retains the bounded queue and parent IDs. `PIE_HN_MAX_DEPTH` (1–10, default 4) limits traversal. The data remains from public sources; a change in the comment count is **not evidence of independent demand**.

The maximum budget is an intentional safety limit. Very large HN discussions are rejected if their checkpoint would exceed 20,000 queued/seen IDs rather than silently dropping replies. Re-run or refresh explicitly when seeking newer replies to a previously completed conversation.

## Blind corroboration holdout (work in progress)

The eight synthetic pairs in `eval/corroboration-pairs.json` are **development data**, not independent validation. To prepare a reproducible, unlabeled annotation queue from source-current, quoted problems:

```bash
PIE_HOLDOUT_TARGET=150 PIE_HOLDOUT_OUTPUT=/tmp/pie-holdout npm run eval:prepare-holdout
```

The four output files are private local artifacts (mode `0600`), not committed: `-blind.json` for annotators, `-audit.json` for sampling provenance and embedding similarity, and `-reviewer-a.json` / `-reviewer-b.json` with **empty labels**. Annotators see public source titles, raw excerpts and URLs, **not** the model's predictions, similarity scores, account identifiers or other reviewers' judgments.

Each reviewer supplies `same_problem`, `different_problem` or `uncertain` with a short rationale for every pair. A separate validator compares both submissions, reports disagreements and unanswered items, and calculates precision/recall only on agreed, non-uncertain pairs:

```bash
npm run eval:review-holdout -- /tmp/pie-holdout-blind.json \
  /tmp/pie-holdout-reviewer-a.json /tmp/pie-holdout-reviewer-b.json
```

Reviewer identities are pseudonyms supplied by the user and are **not authenticated**. No performance claim is independently verified until humans are verified externally and disagreements are adjudicated. Developer-labeled observations from `eval/labels.json` are excluded by default. If fewer than 150 pairs remain, the shortfall is reported instead of silently lowering the target. More source-backed observations are needed to finish the P0 benchmark.

### Hard-pair sampling and frozen holdout safety

The default `eval:prepare-holdout` sampler uses a difficulty-first, provenance-diverse selection, explicitly prioritizing ambiguous semantic neighbors over easy unrelated pairs. All buckets are **unlabeled candidates**; a high embedding similarity does **not** establish a true same-problem pair. Source exposure is bounded where possible, and every pair previously sent to the semantic reviewer is excluded at the SQL level to prevent evaluation leakage.

Frozen reviewer files are immutable by default: attempting to reuse an existing output prefix fails instead of overwriting annotations. Set a fresh prefix, such as `PIE_HOLDOUT_OUTPUT=/tmp/pie-holdout-v3`, for a new dataset. Sampling audits now separately report near-miss (≥0.60), ambiguous (0.35–0.60), contextual (0.15–0.35), and easy-negative candidate bands. These are prioritization categories, not model labels or precision estimates.

## P0: source-backed recurrence probes

The recurrence researcher begins with one or more **current, verified problems** and generates bounded, versioned public search probes. Each probe runs the existing pipeline (GitHub/Hacker News search → source revision triage → free Nemotron extraction → independent quote verification → local embeddings → scoped semantic comparison). The original verified problem, query, search audit and result counts are linked in PostgreSQL's `recurrence_probe_runs` table.

First preview the proposed searches **without web or LLM calls**:

```bash
PIE_RECURRENCE_DRY_RUN=1 PIE_RECURRENCE_SEED_IDS='github:5814924941,github:5779324875' \
  npm run recurrence:research
```

Then run a deliberately small public investigation (requires the existing OpenRouter API key):

```bash
PIE_RECURRENCE_SEED_IDS='github:5814924941,github:5779324875' \
PIE_RECURRENCE_MAX_SEEDS=2 PIE_RECURRENCE_QUERIES=2 \
PIE_RECURRENCE_PER_SOURCE=5 PIE_RECURRENCE_MAX_ANALYZE=2 \
  npm run recurrence:research
```

Strict limits: at most 6 seed problems, 2 searches per seed, 10 raw results per source, 5 new observations analyzed per query, and 10 semantic comparison candidates per query. A provider outage is recorded as an error/partial probe; unrelated probes can still complete. Queries are lexical retrieval leads, **not paraphrase ground truths or evidence of demand**. Different source accounts are not authenticated independent people, and the model's `same_problem` decisions are not used as blind human evaluation labels. Repeating a probe checks for source updates but reuses prior successful model decisions for unchanged posts.

### Firsthand source provenance and retrospective corrections

A public **digest, issue roundup or news bulletin** may quote a genuine bug filed elsewhere, but its author is not an independent firsthand reporter. The deterministic `source-provenance-v1` screen therefore flags narrowly identifiable roundup titles and prevents their extracted claims from being promoted as direct corroboration. It is conservative, title-based, and **does not establish that unflagged sources are firsthand**.

To review and correct older findings **without overwriting the audit history**:

```bash
PIE_PROVENANCE_DRY_RUN=1 npm run audit:provenance
npm run audit:provenance
```

Corrections are new versioned `model_runs`/`model_decisions` with `provider=internal`, while older findings remain in the history. All downstream current-source queries use the latest accepted/rejected decision; the historical embedding can remain stored without being used as current evidence. To establish a firsthand claim from a secondary digest, follow its referenced original issue and verify that primary source separately. The title heuristic cannot detect every syndication or repost and is not an author identity proof.

### Holdout quality preflight (P0)

Before sending a holdout to human annotators, run:

```bash
npm run eval:quality-gate -- /tmp/pie-holdout-v2-blind.json /tmp/pie-holdout-v2-audit.json
```

Without file arguments the command assesses a fresh **in-memory** sampling proposal from the current local PostgreSQL corpus, and does not overwrite any frozen annotation files. It checks pair integrity, source duplication and concentration, cross-platform coverage and numbers of high/medium similarity *candidates*. In the current development corpus, 150 rows can still be inadequate because only two high-similarity candidates are available. A score of `ready_for_human_annotation` is **not** independent validation and does not imply any positive labels. Reviewers must be independent humans and disagreements must be adjudicated; no model precision/recall claim is warranted from this preflight.

### Offline human annotation interface (P0)

Create a private, **self-contained HTML page** from a previously frozen blind queue:

```bash
npm run eval:annotation-ui -- /tmp/pie-holdout-v2-blind.json /tmp/pie-reviewer-a.html
```

Open the resulting local HTML file in Safari or another browser. Review one source pair at a time, follow public source links when needed, choose `same_problem`, `different_problem` or `uncertain`, and write a rationale. Export your answers as a private JSON file compatible with `eval:review-holdout`; an imported JSON file can also restore previously exported answers. Do not share one annotator's responses with another until both have completed independent reviews.

The HTML has no remote scripts, network requests or external UI frameworks. It shows neither similarity scores nor model judgments. The generated file embeds source excerpts and is written privately (`0600`), refusing to overwrite an existing review file. Reviewer pseudonyms do **not** prove independent human identity. This interface does not replace the requirement for external annotation and adjudication.

### Recurrence probe and holdout-diversity safeguards (P0)

Recurrence probes now use **compact GitHub search strings** (2–4 discriminative technical words instead of long AND-style phrases). The search planner is versioned `source-recurrence-probes-v3`. Source search failures (including rate limits) remain explicit; never treat an HTTP 403 as evidence that no similar problem exists. Supply an authorized `GITHUB_TOKEN` through your normal local secret configuration when available; do not commit tokens.

The read-only `eval:quality-gate` now reports **distinct contributing observation IDs per platform** for cross-platform pairs. Many pairs produced from only a few Hacker News sources are not diverse independent evidence. At least eight distinct observations from the less represented platform are expected under the default development gate; this does **not** prove independence of people, original conversations, or market demand. The blind annotator view still excludes these internal diagnostics.

### Search rate-limit classification

Public GitHub search can fail with HTTP 403/429 when unauthenticated requests exhaust a quota. The targeted discovery report now records `reason: rate_limited` (plus a bounded `retryAfterSeconds` hint where supplied), separately from `http_error` and successful zero-result searches. Such a partial discovery is **not** evidence of zero recurring problems. Provide `GITHUB_TOKEN` explicitly in a private local environment to use an authorized quota; never commit or print tokens.

## Recent Hacker News comments as firsthand discovery leads

Hacker News story titles often do not contain the useful problem evidence. The discovery engine can now search **recent public comments**, using Algolia, in addition to GitHub issues and HN stories:

```bash
PIE_INCLUDE_HN_COMMENTS=1 PIE_DISCOVERY_PER_SOURCE=10 \
  npm run discover:search -- 'coding agents'
PIE_INCLUDE_HN_COMMENTS=1 PIE_DISCOVERY_MAX_ANALYZE=4 \
  npm run discovery:cycle -- 'coding agents'
```

The optional third provider is bounded to 1–40 results and a maximum 10-year lookback (default 730 days). Its recent hits must contain a sufficient share of the query's distinguishing words before reaching the LLM, because Algolia's recency ranking can surface unrelated results. Some genuine implicit complaints may be missed by this conservative lexical gate.

Each comment is stored as an observation with an exact source URL, the original HTML source text, a pseudonymous **account key**, and a **`thread_root_id` pointing to the HN story**. Two comments in the same thread are *not two independent discussions*, even when they were posted by different accounts. The evidence graph, semantic clusters, dossiers, and blinded holdout all respect this root; paired comments from one thread are excluded from the cross-discussion holdout.

Comment results are unverified until the same source-quote and semantic-review process runs. A comment that quotes another person's issue is not proof that the commenter experienced it. The standalone public search, extraction, and indexing stages remain independently auditable; comment search failures do not silently disappear from provider status.

### Original discussion lineage in blind-holdout preflight

The sampling audit (not the annotator-facing blind queue) now includes the **original conversation root** for each candidate source. Two Hacker News comments that belong to the same story are never an eligible independent-discussion pair, even if the comment IDs and accounts differ. Quality reports distinguish the number of raw observations from the number of distinct original source threads by platform. This protects against apparent cross-community diversity produced by many comments within the same story; it does not prove that different threads were authored by distinct humans.
