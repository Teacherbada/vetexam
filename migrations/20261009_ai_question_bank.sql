-- Additive only: existing exam questions, users and statistics are untouched.
CREATE TABLE IF NOT EXISTS ai_question_batches (
  id uuid PRIMARY KEY,
  request_key uuid NOT NULL UNIQUE,
  request_hash text NOT NULL,
  name text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  result jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS ai_questions (
  id uuid PRIMARY KEY,
  kind text NOT NULL DEFAULT 'ai' CHECK (kind = 'ai'),
  batch_id uuid NOT NULL REFERENCES ai_question_batches(id),
  position integer NOT NULL,
  content jsonb NOT NULL,
  fingerprint text NOT NULL UNIQUE,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved')),
  reviewed_by text,
  reviewed_at timestamptz,
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='draft' AND review_status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND published_at IS NULL)
    OR (status='published' AND review_status='approved' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND published_at IS NOT NULL)),
  UNIQUE(batch_id,position)
);
CREATE INDEX IF NOT EXISTS ai_questions_batch_idx ON ai_questions(batch_id,position);
CREATE INDEX IF NOT EXISTS ai_questions_published_idx ON ai_questions(status,review_status);
CREATE TABLE IF NOT EXISTS ai_question_attempts (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  request_key uuid NOT NULL,
  question_id uuid NOT NULL REFERENCES ai_questions(id),
  revision integer NOT NULL,
  selected_answer text NOT NULL CHECK (selected_answer IN ('A','B','C','D')),
  is_correct boolean NOT NULL,
  content_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,request_key)
);
CREATE INDEX IF NOT EXISTS ai_question_attempts_user_idx ON ai_question_attempts(user_id,created_at DESC);

CREATE INDEX IF NOT EXISTS ai_question_batches_recent_idx ON ai_question_batches(created_at DESC,id DESC);
