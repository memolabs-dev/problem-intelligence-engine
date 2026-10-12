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
