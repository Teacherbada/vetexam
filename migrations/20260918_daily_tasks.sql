ALTER TABLE study_plans ADD COLUMN IF NOT EXISTS daily_question_target INTEGER;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='study_plans'::regclass AND conname='study_plans_daily_target_check') THEN
    ALTER TABLE study_plans ADD CONSTRAINT study_plans_daily_target_check CHECK (daily_question_target BETWEEN 5 AND 60);
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS daily_tasks (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES study_plans(user_id) ON DELETE CASCADE,
  local_date DATE NOT NULL,
  target_count INTEGER NOT NULL CHECK (target_count > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  UNIQUE(user_id,local_date), UNIQUE(id,user_id)
);
CREATE TABLE IF NOT EXISTS daily_task_items (
  task_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position > 0),
  source TEXT NOT NULL CHECK(source IN ('normal','weakness','follow_up')),
  source_question_id INTEGER NOT NULL,
  session_id UUID NOT NULL,
  item_position INTEGER NOT NULL,
  follow_up_id UUID REFERENCES chapter_follow_ups(id),
  PRIMARY KEY(task_id,position),
  UNIQUE(task_id,source_question_id),
  UNIQUE(task_id,session_id,item_position),
  FOREIGN KEY(task_id,user_id) REFERENCES daily_tasks(id,user_id) ON DELETE CASCADE,
  FOREIGN KEY(session_id,user_id) REFERENCES diagnostic_sessions(id,user_id),
  FOREIGN KEY(session_id,item_position) REFERENCES diagnostic_items(session_id,position),
  CHECK((source='follow_up')=(follow_up_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS daily_task_item_session_idx ON daily_task_items(session_id,item_position);
ALTER TABLE diagnostic_sessions DROP CONSTRAINT IF EXISTS diagnostic_sessions_kind_check;
ALTER TABLE diagnostic_sessions ADD CONSTRAINT diagnostic_sessions_kind_check CHECK (
  (kind IN ('initial','daily') AND parent_session_id IS NULL AND reinforcement_task_id IS NULL AND verification_metadata IS NULL)
  OR (kind='confirmation' AND parent_session_id IS NOT NULL AND parent_session_id<>id AND reinforcement_task_id IS NULL AND verification_metadata IS NULL)
  OR (kind IN ('verification','follow_up') AND parent_session_id IS NOT NULL AND parent_session_id<>id AND reinforcement_task_id IS NOT NULL AND verification_metadata IS NOT NULL)
);
