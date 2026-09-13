-- Additive: mode changes never modify learning history or question records.
CREATE TABLE IF NOT EXISTS study_plans (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('coach', 'custom')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
