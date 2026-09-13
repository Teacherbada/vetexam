ALTER TABLE reinforcement_tasks DROP CONSTRAINT IF EXISTS reinforcement_tasks_status_check;
ALTER TABLE reinforcement_tasks ADD CONSTRAINT reinforcement_tasks_status_check
  CHECK (status IN ('reviewing','reviewed','verifying','short_term','needs_work','deferred','stable','queued'));
DROP INDEX IF EXISTS reinforcement_one_active_user_idx;
CREATE UNIQUE INDEX reinforcement_one_active_user_idx ON reinforcement_tasks(user_id)
  WHERE status IN ('reviewing','reviewed','verifying','needs_work','deferred');

CREATE TABLE IF NOT EXISTS chapter_follow_ups (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES study_plans(user_id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  chapter TEXT NOT NULL CHECK (BTRIM(chapter) <> ''),
  reinforcement_task_id UUID NOT NULL,
  review_attempt INTEGER NOT NULL CHECK (review_attempt > 0),
  stage INTEGER NOT NULL CHECK (stage > 0),
  due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','cancelled')),
  completed_at TIMESTAMPTZ,
  result JSONB,
  intervals JSONB NOT NULL CHECK (jsonb_typeof(intervals) = 'array'),
  session_id UUID UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (reinforcement_task_id, review_attempt, stage),
  FOREIGN KEY (reinforcement_task_id,user_id) REFERENCES reinforcement_tasks(id,user_id),
  FOREIGN KEY (session_id,user_id) REFERENCES diagnostic_sessions(id,user_id),
  CHECK ((status IN ('completed','failed')) = (completed_at IS NOT NULL AND result IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS follow_up_active_chapter_idx ON chapter_follow_ups(user_id,subject,chapter) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS follow_up_due_idx ON chapter_follow_ups(user_id,due_at) WHERE status = 'pending';
ALTER TABLE diagnostic_sessions DROP CONSTRAINT IF EXISTS diagnostic_sessions_kind_check;
ALTER TABLE diagnostic_sessions ADD CONSTRAINT diagnostic_sessions_kind_check CHECK (
  (kind = 'initial' AND parent_session_id IS NULL AND reinforcement_task_id IS NULL AND verification_metadata IS NULL)
  OR (kind = 'confirmation' AND parent_session_id IS NOT NULL AND parent_session_id <> id AND reinforcement_task_id IS NULL AND verification_metadata IS NULL)
  OR (kind IN ('verification','follow_up') AND parent_session_id IS NOT NULL AND parent_session_id <> id AND reinforcement_task_id IS NOT NULL AND verification_metadata IS NOT NULL)
);
