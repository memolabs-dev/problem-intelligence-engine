# Independent corroboration evaluation — annotation protocol (draft)

## Why this exists

The first eight development pairs were used to tune the semantic-review prompt. Their scores cannot establish generalization. This protocol describes how to independently label **new, frozen source pairs** without exposing an annotator to a model's own decisions.

The benchmark asks one narrow question: **Do two public source observations describe substantially the same underlying user difficulty?** It does not evaluate actual willingness to pay, distinct human identities, severity, the number of users affected, or whether a business should be built.

## Preparation

1. Run `npm run eval:prepare-holdout` on a sufficiently diverse, current, source-backed corpus. By default this excludes all observations from `eval/labels.json` that were used during development.
2. Freeze the exported `-blind.json` and separately save the `-audit.json`, ideally recording SHA-256 checksums. Keep both private. Candidate selection is stratified by account duplication, platform differences, same-repository, and embedding distance; **stratum membership and similarity scores must not be shown to annotators**.
3. Give the same frozen blind file to **two separate human reviewers**, using the two initially empty annotation files. Do not show reviewers any `corroboration_edges` verdicts, the current model output, or each other's labels.
4. For each pair, read the source title and body, follow the source URL when the excerpt is insufficient, and record one label **and a brief rationale**. Clips can be up to 1,500 characters, so the original page may be needed.
5. Only after both submissions are complete, run `npm run eval:review-holdout -- <blind> <reviewer-a> <reviewer-b>`. Adjudicate disagreements separately, without silently overwriting either reviewer's original label.

## Label rubric

**`same_problem`** — Both sources describe effectively the same failure mode or unmet need. A product or fix that addresses the first concrete difficulty would plausibly solve the second. The wording, technology names and environment may differ.

**`different_problem`** — The subjects share vocabulary, product or ecosystem, but their concrete failures, root causes or user needs differ. For example, two bundler reports involving *different* breakages should not merge just because both mention a bundler.

**`uncertain`** — Neither label can be justified confidently from the publicly available source. Use this when reports are vague, incomplete, contradictory, inaccessible or merely speculative. Do not guess a matching problem.

A pair posted twice by the same account **can still be `same_problem`**. Independence of reporters is measured separately; it is never inferred from the semantic label. Agreement-only comments should not establish firsthand experience.

## Scoring and reporting

- Count true positives, false positives, true negatives, false negatives, model failures and unresolved annotations **separately**.
- Precision of merges = TP/(TP+FP), recall = TP/(TP+FN), when denominators are nonzero. Never replace undefined metrics with 100%.
- Disagreements and `uncertain` labels remain unresolved; exclude them from the confusion matrix and **report coverage**.
- Specifically review severe false merges: similar keywords, different concrete user needs.
- Report dataset size, source mix, cross-platform share, same-account share, selection strata and number of excluded development examples.
- Scores on a model-screened pool are **conditional on that extraction pipeline**. They are not population-level market metrics.

## Independence and ethical limitations

A pseudonym in an annotation file does not prove a distinct human reviewed it. The utility cannot verify human independence or adjudication; it explicitly refuses to label the results "independently validated" on its own. Keep the human labeling and adjudication logs auditable outside the generated repository.

The source corpus consists of public posts and can contain incidental personal information. Do not publish raw excerpts unnecessarily, don't contact source authors without an appropriate process, and don't infer personal identity from hashed account keys.

**Current state (12 October 2026):** 30 source-grounded problems are vectorized; the frozen candidate queue contains 150 previously unlabeled pairs after excluding examples used in development. **No independent human labels exist yet.** Of those 150 candidate pairs, only 2 have embedding similarity ≥ 0.60; the pool is heavily weighted toward likely negatives, which limits how well it may eventually measure recall. Additional hard paraphrases and true cross-community recurrences should be sought *before* treating this as a balanced benchmark. Do not tune prompts against the frozen holdout.

### Discussion independence after the HN comment connector

Public HN comments retain `thread_root_id` pointing to the parent story. A pair of comments within the same story is not a cross-discussion independent source pair even if two pseudonymous accounts posted it. The holdout query excludes these same-root pairs. Human annotators should still distinguish *same underlying technical problem* from *different problem*: the annotation label itself does not assert distinct human identities. HN search queries that retrieve comments are filtered by relevant words before LLM screening; consequently the sampled corpus is **not** a representative random sample of online discussion.
