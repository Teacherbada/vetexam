-- Existing rows deliberately remain NULL; retries never backfill old answers.
ALTER TABLE question_answer_stats
  ADD COLUMN IF NOT EXISTS selected_answer TEXT
  CONSTRAINT question_answer_stats_selected_answer_check
  CHECK (selected_answer IS NULL OR selected_answer IN ('A','B','C','D','E'));
