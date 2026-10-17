-- Additive, no backfill and no changes to existing plans, tasks or answers.
ALTER TABLE study_plans ADD COLUMN IF NOT EXISTS coach_state jsonb;
COMMENT ON COLUMN study_plans.coach_state IS 'Coach-only chapter review schedule and week-scoped subject preference, version 1; NULL means no new state.';
-- Bounded recent-evidence and week-report reads; existing rows are not rewritten.
CREATE INDEX IF NOT EXISTS diagnostic_items_answered_time_idx ON diagnostic_items(answered_at,session_id) WHERE answered_at IS NOT NULL;
