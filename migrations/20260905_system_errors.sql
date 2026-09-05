BEGIN;

-- Additive migration: no existing application tables are changed.
CREATE TABLE IF NOT EXISTS system_errors (
  id BIGSERIAL PRIMARY KEY,
  event_code TEXT NOT NULL,
  error_kind TEXT NOT NULL CHECK (error_kind IN ('database', 'timeout', 'unexpected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS system_errors_created_at_id_idx
  ON system_errors (created_at DESC, id DESC);

COMMIT;
