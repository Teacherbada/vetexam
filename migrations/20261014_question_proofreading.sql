-- Additive metadata only. Existing questions, answers, images and attempts are untouched.
CREATE TABLE IF NOT EXISTS question_proofreading (
  question_id integer PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  version bigint NOT NULL DEFAULT 0,
  images jsonb,
  image_fingerprint text,
  reviewed_fingerprint text,
  reviewed_by text,
  reviewed_at timestamptz,
  history_notice boolean NOT NULL DEFAULT false,
  CHECK (images IS NULL OR jsonb_typeof(images)='array')
);
CREATE TABLE IF NOT EXISTS question_edit_history (
  id bigserial PRIMARY KEY,
  question_id integer NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL CHECK (action IN ('save','restore','review','unreview')),
  changed_fields text[] NOT NULL,
  before_data jsonb NOT NULL,
  after_data jsonb NOT NULL,
  request_id uuid NOT NULL,
  UNIQUE(actor_id,request_id)
);
CREATE INDEX IF NOT EXISTS question_edit_history_question_idx ON question_edit_history(question_id,id DESC);
CREATE TABLE IF NOT EXISTS question_bank_proofreading (
  question_set_id integer PRIMARY KEY REFERENCES question_sets(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  completed_by text NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);
-- Existing five-option questions can accept more than one of their actual choices.
CREATE OR REPLACE FUNCTION vetexam_answer_keys(value text) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE body jsonb; result text[];
BEGIN
  IF value IS NULL OR btrim(value)='' THEN RETURN ARRAY[]::text[]; END IF;
  IF upper(btrim(value)) ~ '^[A-E]$' THEN RETURN ARRAY[upper(btrim(value))]; END IF;
  BEGIN body := value::jsonb; EXCEPTION WHEN invalid_text_representation THEN RETURN ARRAY[]::text[]; END;
  IF jsonb_typeof(body)<>'array' THEN RETURN ARRAY[]::text[]; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(body) item WHERE jsonb_typeof(item)<>'string' OR (item #>> '{}') !~ '^[A-E]$') THEN RETURN ARRAY[]::text[]; END IF;
  SELECT array_agg(DISTINCT item ORDER BY item) INTO result FROM jsonb_array_elements_text(body) item;
  RETURN COALESCE(result,ARRAY[]::text[]);
END $$;
