CREATE TABLE IF NOT EXISTS reinforcement_tasks (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES study_plans(user_id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  chapter TEXT NOT NULL CHECK (BTRIM(chapter) <> ''),
  source_session_id UUID NOT NULL,
  source_analysis JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reviewing','reviewed','verifying','short_term','needs_work','deferred')),
  paused_status TEXT CHECK (paused_status IN ('reviewing','reviewed','verifying','needs_work')),
  review_count INTEGER NOT NULL DEFAULT 1 CHECK (review_count > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  review_completed_at TIMESTAMPTZ,
  verification_completed_at TIMESTAMPTZ,
  UNIQUE (id, user_id),
  FOREIGN KEY (source_session_id, user_id) REFERENCES diagnostic_sessions(id, user_id),
  CHECK ((status = 'deferred') = (paused_status IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS reinforcement_one_active_user_idx
  ON reinforcement_tasks(user_id) WHERE status <> 'short_term';
CREATE INDEX IF NOT EXISTS reinforcement_user_created_idx ON reinforcement_tasks(user_id, created_at DESC);

ALTER TABLE diagnostic_sessions ADD COLUMN IF NOT EXISTS reinforcement_task_id UUID;
ALTER TABLE diagnostic_sessions ADD COLUMN IF NOT EXISTS verification_metadata JSONB;
ALTER TABLE diagnostic_sessions DROP CONSTRAINT IF EXISTS diagnostic_sessions_kind_check;
ALTER TABLE diagnostic_sessions ADD CONSTRAINT diagnostic_sessions_kind_check CHECK (
  (kind = 'initial' AND parent_session_id IS NULL AND reinforcement_task_id IS NULL AND verification_metadata IS NULL)
  OR (kind = 'confirmation' AND parent_session_id IS NOT NULL AND parent_session_id <> id AND reinforcement_task_id IS NULL AND verification_metadata IS NULL)
  OR (kind = 'verification' AND parent_session_id IS NOT NULL AND parent_session_id <> id AND reinforcement_task_id IS NOT NULL AND verification_metadata IS NOT NULL)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'diagnostic_sessions'::regclass AND conname = 'diagnostic_sessions_reinforcement_fk') THEN
    ALTER TABLE diagnostic_sessions ADD CONSTRAINT diagnostic_sessions_reinforcement_fk
      FOREIGN KEY (reinforcement_task_id, user_id) REFERENCES reinforcement_tasks(id, user_id);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS verification_task_review_idx
  ON diagnostic_sessions(reinforcement_task_id, ((verification_metadata->>'review_attempt')::integer)) WHERE kind = 'verification';
