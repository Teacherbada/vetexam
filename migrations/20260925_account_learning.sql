-- Additive. Coach/custom attempts remain in diagnostic_items; no duplicate backfill.
CREATE TABLE IF NOT EXISTS practice_attempts (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  event_id UUID NOT NULL,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_answer TEXT NOT NULL CHECK(selected_answer IN ('A','B','C','D','E')),
  is_correct BOOLEAN NOT NULL,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  mode TEXT NOT NULL CHECK(mode IN ('practice','exam')),
  PRIMARY KEY(user_id,event_id)
);
CREATE INDEX IF NOT EXISTS practice_attempts_history_idx ON practice_attempts(user_id,question_id,answered_at);
CREATE TABLE IF NOT EXISTS question_review_state (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  favorite BOOLEAN NOT NULL DEFAULT FALSE,
  wrong BOOLEAN,
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(user_id,question_id)
);
-- Legacy summaries cannot reconstruct per-question correctness or timestamps.
-- Preserve their complete original payload separately, never as measured attempts.
CREATE TABLE IF NOT EXISTS learning_imports (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  device_id UUID NOT NULL,
  payload JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id,device_id)
);
