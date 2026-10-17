-- Additive snapshot only. Existing tasks, questions and answers are not rewritten.
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS coach_plan jsonb;
COMMENT ON COLUMN daily_tasks.coach_plan IS 'Versioned daily coaching groups and reasons; NULL preserves legacy task ordering.';
