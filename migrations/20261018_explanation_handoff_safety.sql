-- Apply only after backup, in a transaction, before the Phase 3 application release.
-- No backfill: old text/status/versions remain unchanged. Requires proofreading migration.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS explanation_binding jsonb;
CREATE TABLE IF NOT EXISTS explanation_import_receipts (
  actor_id text NOT NULL,
  request_id text NOT NULL,
  payload_hash text NOT NULL,
  result jsonb,
  input jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id,request_id)
);
CREATE TABLE IF NOT EXISTS explanation_review_events (
  id bigserial PRIMARY KEY,
  question_id integer NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  before_data jsonb NOT NULL,
  after_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS explanation_import_receipts_actor_date_idx ON explanation_import_receipts(actor_id,created_at DESC,request_id);
CREATE INDEX IF NOT EXISTS explanation_review_events_question_idx ON explanation_review_events(question_id,id DESC);

-- Versioned database signature: no new claim about the authenticity of official sources.
CREATE OR REPLACE FUNCTION vetexam_explanation_digest(value text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT encode(sha256(convert_to(value,'UTF8')),'hex') $$;
CREATE OR REPLACE FUNCTION vetexam_explanation_question_fields(q jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_array(q->'id',q->'question_set_id',q->'kind',q->'question',
 q->'option_a',q->'option_b',q->'option_c',q->'option_d',q->'option_e',q->'answer',q->'subject',q->'chapter',
 q->'question_number',vetexam_explanation_digest(COALESCE(q->>'image_data_url',''))) $$;
CREATE OR REPLACE FUNCTION vetexam_explanation_bank_fields(q jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_array(q->'name',q->'exam_year',q->'exam_subject',q->'filename',q->'file_hash',q->'visibility') $$;
CREATE OR REPLACE FUNCTION vetexam_explanation_source(target_id integer) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT vetexam_explanation_digest(jsonb_build_array('explanation-source-v1',
 vetexam_explanation_question_fields(to_jsonb(q)),vetexam_explanation_bank_fields(to_jsonb(qs)),
 COALESCE(m.version,0),vetexam_explanation_digest(COALESCE(m.images::text,'')),m.image_fingerprint)::text)
 FROM questions q JOIN question_sets qs ON qs.id=q.question_set_id
 LEFT JOIN question_proofreading m ON m.question_id=q.id WHERE q.id=target_id $$;

CREATE OR REPLACE FUNCTION vetexam_explanation_question_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.explanation_binding IS NOT NULL AND
   vetexam_explanation_question_fields(to_jsonb(OLD)) IS DISTINCT FROM vetexam_explanation_question_fields(to_jsonb(NEW)) THEN
   NEW.explanation_status := 'draft';
   NEW.explanation_version := GREATEST(NEW.explanation_version,OLD.explanation_version+1);
 ELSIF NEW.explanation_binding IS NOT NULL AND NEW.explanation_status='published' THEN
   IF NEW.explanation_binding->>'sourceSignature' IS DISTINCT FROM vetexam_explanation_source(OLD.id) THEN
     RAISE EXCEPTION 'Explanation source changed; review required';
   END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS explanation_question_guard ON questions;
CREATE TRIGGER explanation_question_guard BEFORE UPDATE ON questions FOR EACH ROW EXECUTE FUNCTION vetexam_explanation_question_guard();

CREATE OR REPLACE FUNCTION vetexam_explanation_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='question_sets' THEN
   IF vetexam_explanation_bank_fields(to_jsonb(OLD)) IS DISTINCT FROM vetexam_explanation_bank_fields(to_jsonb(NEW)) THEN
     UPDATE questions SET explanation_status='draft',explanation_version=explanation_version+1
     WHERE question_set_id=NEW.id AND explanation_binding IS NOT NULL AND kind='exam';
   END IF;
 ELSE
   IF TG_OP<>'UPDATE' OR jsonb_build_array(OLD.version,OLD.images,OLD.image_fingerprint) IS DISTINCT FROM jsonb_build_array(NEW.version,NEW.images,NEW.image_fingerprint) THEN
     UPDATE questions SET explanation_status='draft',explanation_version=explanation_version+1
     WHERE id=COALESCE(NEW.question_id,OLD.question_id) AND explanation_binding IS NOT NULL AND kind='exam';
   END IF;
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS explanation_bank_guard ON question_sets;
CREATE TRIGGER explanation_bank_guard AFTER UPDATE ON question_sets FOR EACH ROW EXECUTE FUNCTION vetexam_explanation_source_guard();
DROP TRIGGER IF EXISTS explanation_images_guard ON question_proofreading;
CREATE TRIGGER explanation_images_guard AFTER INSERT OR UPDATE OR DELETE ON question_proofreading FOR EACH ROW EXECUTE FUNCTION vetexam_explanation_source_guard();
