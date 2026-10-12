CREATE TABLE IF NOT EXISTS observations (
 id TEXT PRIMARY KEY,
 source TEXT NOT NULL CHECK (source IN ('github','hackernews')),
 external_id TEXT NOT NULL,
 url TEXT NOT NULL,
 title TEXT NOT NULL DEFAULT '',
 body TEXT NOT NULL DEFAULT '',
 published_at TIMESTAMPTZ,
 content_hash CHAR(64) NOT NULL,
 ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(source, external_id)
);
CREATE INDEX IF NOT EXISTS observations_source_published_idx ON observations(source, published_at DESC);
CREATE TABLE IF NOT EXISTS problems (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 statement TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','reviewed','rejected')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS problem_evidence (
 problem_id BIGINT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
 observation_id TEXT NOT NULL REFERENCES observations(id) ON DELETE RESTRICT,
 excerpt TEXT NOT NULL,
 PRIMARY KEY(problem_id, observation_id)
);

-- Model decisions are append-only historical evidence. They do not assert market demand.
CREATE TABLE IF NOT EXISTS model_runs (
 id UUID PRIMARY KEY,
 provider TEXT NOT NULL,
 model TEXT NOT NULL,
 pipeline_version TEXT NOT NULL,
 started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 total_observations INTEGER NOT NULL CHECK (total_observations >= 0)
);
CREATE TABLE IF NOT EXISTS model_decisions (
 run_id UUID NOT NULL REFERENCES model_runs(id) ON DELETE RESTRICT,
 observation_id TEXT NOT NULL REFERENCES observations(id) ON DELETE RESTRICT,
 source_content_hash CHAR(64) NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('found','none','rejected','error')),
 statement TEXT,
 excerpt TEXT,
 extraction_method TEXT,
 qualification TEXT,
 elapsed_ms INTEGER,
 market_validation TEXT NOT NULL DEFAULT 'unknown' CHECK (market_validation IN ('unknown','under_review','validated','rejected')),
 PRIMARY KEY (run_id, observation_id),
 CHECK (
   status <> 'found'
   OR (statement IS NOT NULL AND length(statement) >= 12 AND excerpt IS NOT NULL AND length(excerpt) >= 12)
 )
);
CREATE INDEX IF NOT EXISTS model_decisions_observation_idx ON model_decisions(observation_id);

ALTER TABLE model_decisions ADD COLUMN IF NOT EXISTS extraction_method TEXT;

ALTER TABLE observations ADD COLUMN IF NOT EXISTS reporter_key TEXT;
CREATE TABLE IF NOT EXISTS conversation_messages (
 id TEXT PRIMARY KEY,
 observation_id TEXT NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
 parent_id TEXT NOT NULL,
 source TEXT NOT NULL,
 author_key TEXT,
 url TEXT NOT NULL,
 body TEXT NOT NULL,
 published_at TIMESTAMPTZ,
 content_hash CHAR(64) NOT NULL,
 fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS conversation_messages_root_idx ON conversation_messages(observation_id);
CREATE INDEX IF NOT EXISTS conversation_messages_author_idx ON conversation_messages(author_key);
CREATE TABLE IF NOT EXISTS problem_embeddings (
 run_id UUID NOT NULL,
 observation_id TEXT NOT NULL,
 embedding_model TEXT NOT NULL,
 statement_hash CHAR(64) NOT NULL,
 embedding vector(384) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY (run_id,observation_id,embedding_model),
 FOREIGN KEY (run_id,observation_id) REFERENCES model_decisions(run_id,observation_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS problem_embeddings_vector_idx ON problem_embeddings USING hnsw (embedding vector_cosine_ops);
CREATE TABLE IF NOT EXISTS corroboration_edges (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 left_run UUID NOT NULL,
 left_observation TEXT NOT NULL,
 right_run UUID NOT NULL,
 right_observation TEXT NOT NULL,
 model TEXT NOT NULL,
 verdict TEXT NOT NULL CHECK (verdict IN ('same_problem','different_problem','uncertain','error')),
 rationale TEXT,
 compared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 FOREIGN KEY(left_run,left_observation) REFERENCES model_decisions(run_id,observation_id),
 FOREIGN KEY(right_run,right_observation) REFERENCES model_decisions(run_id,observation_id),
 UNIQUE(left_run,left_observation,right_run,right_observation,model),
 CHECK(left_observation<>right_observation)
);
CREATE TABLE IF NOT EXISTS conversation_support (
 run_id UUID NOT NULL,
 observation_id TEXT NOT NULL,
 message_id TEXT NOT NULL REFERENCES conversation_messages(id),
 model TEXT NOT NULL,
 verdict TEXT NOT NULL CHECK (verdict IN ('firsthand_same_problem','agreement_only','other_problem','irrelevant','uncertain','error')),
 excerpt TEXT,
 reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(run_id,observation_id,message_id,model),
 FOREIGN KEY(run_id,observation_id) REFERENCES model_decisions(run_id,observation_id)
);
CREATE INDEX IF NOT EXISTS conversation_support_root_idx ON conversation_support(observation_id,verdict);
ALTER TABLE conversation_support ADD COLUMN IF NOT EXISTS raw_verdict TEXT;

-- Audit each targeted public search separately from the verified problem model.
CREATE TABLE IF NOT EXISTS targeted_search_runs (
 id UUID PRIMARY KEY,
 query TEXT NOT NULL,
 github_status TEXT NOT NULL,
 hackernews_status TEXT NOT NULL,
 searched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 matched_raw INTEGER NOT NULL CHECK (matched_raw>=0),
 unique_observations INTEGER NOT NULL CHECK (unique_observations>=0)
);
CREATE TABLE IF NOT EXISTS targeted_search_hits (
 run_id UUID NOT NULL REFERENCES targeted_search_runs(id) ON DELETE CASCADE,
 observation_id TEXT NOT NULL REFERENCES observations(id) ON DELETE RESTRICT,
 source_content_hash CHAR(64) NOT NULL,
 PRIMARY KEY(run_id,observation_id)
);
CREATE INDEX IF NOT EXISTS targeted_search_hits_observation_idx ON targeted_search_hits(observation_id);

-- A checkpoint belongs to one root discussion and is updated atomically with
-- its messages. A partial/error state resumes at the same cursor; complete
-- threads are skipped unless an explicit refresh is requested.
CREATE TABLE IF NOT EXISTS conversation_ingestion_state (
 observation_id TEXT PRIMARY KEY REFERENCES observations(id) ON DELETE CASCADE,
 source TEXT NOT NULL CHECK (source IN ('github','hackernews')),
 cursor JSONB,
 status TEXT NOT NULL CHECK (status IN ('partial','complete','error')),
 processed_count BIGINT NOT NULL DEFAULT 0 CHECK (processed_count>=0),
 last_error TEXT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS conversation_ingestion_state_status_idx
 ON conversation_ingestion_state(status,updated_at);

-- Research probes link a verified problem's source revision to public search
-- runs; suggestions are evidence leads, not validated corroboration.
CREATE TABLE IF NOT EXISTS recurrence_probe_runs (
 id UUID PRIMARY KEY,
 seed_observation_id TEXT NOT NULL REFERENCES observations(id) ON DELETE RESTRICT,
 seed_content_hash CHAR(64) NOT NULL,
 query TEXT NOT NULL,
 planner_version TEXT NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('completed','partial','error')),
 search_run_id UUID REFERENCES targeted_search_runs(id) ON DELETE SET NULL,
 result_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS recurrence_probe_runs_seed_idx ON recurrence_probe_runs(seed_observation_id,created_at DESC);

-- HN comments may be independent observations yet belong to the same story.
-- The original thread root is a reporting unit; multiple comments in one
-- thread are NOT independent public discussions.
ALTER TABLE observations ADD COLUMN IF NOT EXISTS thread_root_id TEXT;
CREATE INDEX IF NOT EXISTS observations_thread_root_idx ON observations(thread_root_id);
ALTER TABLE targeted_search_runs ADD COLUMN IF NOT EXISTS hackernews_comments_status TEXT NOT NULL DEFAULT 'not_run';
