CREATE TABLE IF NOT EXISTS custom_plans (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES study_plans(user_id) ON DELETE CASCADE,
  config JSONB NOT NULL CHECK(jsonb_typeof(config)='object'),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed')),
  pool_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  UNIQUE(id,user_id)
);
-- This is a scope ledger, not a second answer store. Actual answers remain in diagnostic_items.
CREATE TABLE IF NOT EXISTS custom_plan_questions (
  plan_id UUID NOT NULL REFERENCES custom_plans(id) ON DELETE CASCADE,
  source_question_id INTEGER NOT NULL,
  subject TEXT NOT NULL,
  chapter TEXT,
  excluded_prior BOOLEAN NOT NULL,
  in_scope BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY(plan_id,source_question_id)
);
CREATE TABLE IF NOT EXISTS custom_daily_tasks (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan_id UUID NOT NULL,
  local_date DATE NOT NULL,
  target_count INTEGER NOT NULL CHECK(target_count BETWEEN 1 AND 200),
  config JSONB NOT NULL,
  session_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id,local_date,plan_id),
  FOREIGN KEY(plan_id,user_id) REFERENCES custom_plans(id,user_id),
  FOREIGN KEY(session_id,user_id) REFERENCES diagnostic_sessions(id,user_id)
);
ALTER TABLE diagnostic_sessions DROP CONSTRAINT IF EXISTS diagnostic_sessions_kind_check;
ALTER TABLE diagnostic_sessions ADD CONSTRAINT diagnostic_sessions_kind_check CHECK (
  (kind IN ('initial','daily','custom') AND parent_session_id IS NULL AND reinforcement_task_id IS NULL AND verification_metadata IS NULL)
  OR (kind='confirmation' AND parent_session_id IS NOT NULL AND parent_session_id<>id AND reinforcement_task_id IS NULL AND verification_metadata IS NULL)
  OR (kind IN ('verification','follow_up') AND parent_session_id IS NOT NULL AND parent_session_id<>id AND reinforcement_task_id IS NOT NULL AND verification_metadata IS NOT NULL)
);
