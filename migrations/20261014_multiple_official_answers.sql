-- Additive parser; no existing question, answer, attempt or coach snapshot is rewritten.
-- Single legacy values (including historical E) keep their existing meaning.
CREATE OR REPLACE FUNCTION vetexam_answer_keys(value text) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE body jsonb; result text[];
BEGIN
  IF value IS NULL OR btrim(value)='' THEN RETURN ARRAY[]::text[]; END IF;
  IF upper(btrim(value)) ~ '^[A-E]$' THEN RETURN ARRAY[upper(btrim(value))]; END IF;
  BEGIN body := value::jsonb; EXCEPTION WHEN invalid_text_representation THEN RETURN ARRAY[]::text[]; END;
  IF jsonb_typeof(body)<>'array' THEN RETURN ARRAY[]::text[]; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(body) item WHERE jsonb_typeof(item)<>'string' OR (item #>> '{}') !~ '^[A-D]$') THEN RETURN ARRAY[]::text[]; END IF;
  SELECT array_agg(DISTINCT item ORDER BY item) INTO result FROM jsonb_array_elements_text(body) item;
  RETURN COALESCE(result,ARRAY[]::text[]);
END $$;
CREATE OR REPLACE FUNCTION vetexam_has_answer(value text, options text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT cardinality(vetexam_answer_keys(value))>0 AND NOT EXISTS(
    SELECT 1 FROM unnest(vetexam_answer_keys(value)) letter WHERE NULLIF(btrim(options[ascii(letter)-64]),'') IS NULL
  )
$$;
-- Widen only the existing answer-key constraint; selected_answer remains single-choice.
ALTER TABLE diagnostic_items DROP CONSTRAINT IF EXISTS diagnostic_items_answer_key_check;
ALTER TABLE diagnostic_items ADD CONSTRAINT diagnostic_items_answer_key_check
  CHECK (cardinality(vetexam_answer_keys(answer_key))>0) NOT VALID;
ALTER TABLE diagnostic_items VALIDATE CONSTRAINT diagnostic_items_answer_key_check;
