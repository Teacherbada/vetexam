-- Additive and rerunnable. Existing quiz/auth tables are not altered.
CREATE TABLE IF NOT EXISTS question_answer_stats (
  id BIGSERIAL PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  is_correct BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT question_answer_stats_user_question_key UNIQUE (user_id, question_id)
);

CREATE INDEX IF NOT EXISTS question_answer_stats_question_idx
  ON question_answer_stats (question_id);
CREATE INDEX IF NOT EXISTS question_answer_stats_created_idx
  ON question_answer_stats (created_at);
