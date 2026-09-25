-- Additive scheduler state only. No fabricated history or backfill.
-- Card fields match ts-fsrs 5.4.2, including learning_steps.
CREATE TABLE IF NOT EXISTS question_memory_state (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  due TIMESTAMPTZ NOT NULL,
  stability DOUBLE PRECISION NOT NULL CHECK(stability >= 0 AND stability < 'Infinity'::float8),
  difficulty DOUBLE PRECISION NOT NULL CHECK(difficulty >= 0 AND difficulty <= 10),
  elapsed_days INTEGER NOT NULL CHECK(elapsed_days >= 0),
  scheduled_days INTEGER NOT NULL CHECK(scheduled_days >= 0),
  learning_steps INTEGER NOT NULL CHECK(learning_steps >= 0),
  reps INTEGER NOT NULL CHECK(reps >= 0),
  lapses INTEGER NOT NULL CHECK(lapses >= 0),
  state SMALLINT NOT NULL CHECK(state IN (0,1,2,3)),
  last_review TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(user_id,question_id)
);
CREATE INDEX IF NOT EXISTS question_memory_due_idx ON question_memory_state(user_id,due);
