-- Preserve every existing explanation verbatim. No automatic publication.
-- Public readers fail closed before this migration via to_jsonb(q).
ALTER TABLE questions ADD COLUMN IF NOT EXISTS explanation_status text NOT NULL DEFAULT 'draft'
  CHECK (explanation_status IN ('draft','published'));
ALTER TABLE questions ADD COLUMN IF NOT EXISTS explanation_version bigint NOT NULL DEFAULT 0;
-- Empty content is displayed as "unwritten" rather than a separate stored state.
-- Private banks ignore these metadata fields. AI questions use a separate table.
