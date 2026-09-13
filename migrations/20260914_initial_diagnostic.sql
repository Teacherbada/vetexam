-- Additive only. One initial diagnostic per existing study plan.
CREATE TABLE IF NOT EXISTS diagnostic_sessions (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES study_plans(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ
);

-- Session-specific snapshot and response, not a replacement for general history.
-- source_question_id preserves the original identifier even if its source is deleted.
CREATE TABLE IF NOT EXISTS diagnostic_items (
  session_id UUID NOT NULL REFERENCES diagnostic_sessions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position > 0),
  question_id INTEGER REFERENCES questions(id) ON DELETE SET NULL,
  source_question_id INTEGER NOT NULL,
  subject TEXT NOT NULL,
  chapter TEXT,
  question TEXT NOT NULL,
  options JSONB NOT NULL CHECK (jsonb_typeof(options) = 'array'),
  image TEXT,
  answer_key TEXT NOT NULL CHECK (answer_key IN ('A','B','C','D','E')),
  selected_answer TEXT CHECK (selected_answer IN ('A','B','C','D','E')),
  is_correct BOOLEAN,
  answered_at TIMESTAMPTZ,
  PRIMARY KEY (session_id, position),
  UNIQUE (session_id, source_question_id),
  CHECK ((selected_answer IS NULL AND is_correct IS NULL AND answered_at IS NULL)
    OR (selected_answer IS NOT NULL AND is_correct IS NOT NULL AND answered_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS diagnostic_items_question_idx ON diagnostic_items(question_id);
