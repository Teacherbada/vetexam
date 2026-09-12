-- Staging only; existing question/question_set/auth tables are not changed.
CREATE TABLE IF NOT EXISTS pdf_batch_imports (
  id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  metadata JSONB NOT NULL,
  question_set_id INTEGER REFERENCES question_sets(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS pdf_batch_imports_owner_created_idx ON pdf_batch_imports(owner_id, created_at);
CREATE TABLE IF NOT EXISTS pdf_import_chunks (
  import_id UUID NOT NULL REFERENCES pdf_batch_imports(id) ON DELETE CASCADE,
  batch_index INTEGER NOT NULL CHECK (batch_index >= 0),
  payload_hash TEXT NOT NULL,
  questions JSONB,
  PRIMARY KEY (import_id, batch_index)
);
