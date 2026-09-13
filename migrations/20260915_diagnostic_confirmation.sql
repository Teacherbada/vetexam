-- Preserve all initial sessions and items; extend the existing diagnostic model.
ALTER TABLE diagnostic_sessions ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'initial';
ALTER TABLE diagnostic_sessions ADD COLUMN IF NOT EXISTS parent_session_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS diagnostic_sessions_initial_user_idx
  ON diagnostic_sessions(user_id) WHERE kind = 'initial';
CREATE UNIQUE INDEX IF NOT EXISTS diagnostic_sessions_id_user_idx ON diagnostic_sessions(id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS diagnostic_sessions_active_confirmation_idx
  ON diagnostic_sessions(user_id) WHERE kind = 'confirmation' AND completed_at IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'diagnostic_sessions'::regclass AND conname = 'diagnostic_sessions_kind_check') THEN
    ALTER TABLE diagnostic_sessions ADD CONSTRAINT diagnostic_sessions_kind_check
      CHECK ((kind = 'initial' AND parent_session_id IS NULL) OR (kind = 'confirmation' AND parent_session_id IS NOT NULL AND parent_session_id <> id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'diagnostic_sessions'::regclass AND conname = 'diagnostic_sessions_parent_fk') THEN
    ALTER TABLE diagnostic_sessions ADD CONSTRAINT diagnostic_sessions_parent_fk
      FOREIGN KEY (parent_session_id, user_id) REFERENCES diagnostic_sessions(id, user_id);
  END IF;
END $$;

-- Replaced by the initial-only unique index above; no rows are deleted.
ALTER TABLE diagnostic_sessions DROP CONSTRAINT IF EXISTS diagnostic_sessions_user_id_key;
CREATE INDEX IF NOT EXISTS diagnostic_sessions_user_kind_idx ON diagnostic_sessions(user_id, kind, created_at DESC);
