-- Additive. Apply after 20261009_ai_question_bank.sql. No exam tables touched.
CREATE TABLE IF NOT EXISTS ai_materials (
  id uuid PRIMARY KEY, fingerprint text NOT NULL UNIQUE, filename text NOT NULL,
  pdf bytea NOT NULL CHECK (octet_length(pdf) <= 3145728), pages jsonb NOT NULL,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_generation_jobs (
  id uuid PRIMARY KEY, request_key uuid NOT NULL UNIQUE, fingerprint text NOT NULL UNIQUE,
  material_id uuid NOT NULL REFERENCES ai_materials(id), batch_id uuid NOT NULL REFERENCES ai_question_batches(id),
  spec jsonb NOT NULL, model text NOT NULL, reserved_micro_usd integer NOT NULL CHECK(reserved_micro_usd BETWEEN 1 AND 200000),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_generation_items (
  job_id uuid NOT NULL REFERENCES ai_generation_jobs(id), position integer NOT NULL CHECK(position BETWEEN 1 AND 10),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','done','failed','uncertain')),
  claim uuid, started_at timestamptz, finished_at timestamptz, error text,
  question_id uuid REFERENCES ai_questions(id), usage jsonb, actual_micro_usd integer,
  reserved_micro_usd integer NOT NULL DEFAULT 16640 CHECK(reserved_micro_usd = 16640),
  PRIMARY KEY(job_id,position)
);
CREATE INDEX IF NOT EXISTS ai_generation_items_started ON ai_generation_items(started_at);
CREATE TABLE IF NOT EXISTS ai_question_material_sources (
  question_id uuid PRIMARY KEY REFERENCES ai_questions(id), material_id uuid NOT NULL REFERENCES ai_materials(id),
  pdf_page integer NOT NULL CHECK(pdf_page > 0), page_hash text NOT NULL
);
-- A tombstone preserves attempts and prevents accidental re-import of a removed question.
ALTER TABLE ai_questions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
