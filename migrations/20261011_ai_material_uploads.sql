ALTER TABLE ai_materials DROP CONSTRAINT IF EXISTS ai_materials_pdf_check;
ALTER TABLE ai_materials ADD CONSTRAINT ai_materials_pdf_check CHECK (octet_length(pdf) <= 104857600);
CREATE TABLE IF NOT EXISTS ai_material_uploads (
  id uuid PRIMARY KEY, created_by text NOT NULL, filename text NOT NULL,
  byte_length integer NOT NULL CHECK (byte_length BETWEEN 5 AND 104857600),
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','processing','done')),
  claim uuid, claimed_at timestamptz, material_id uuid REFERENCES ai_materials(id),
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours'
);
CREATE TABLE IF NOT EXISTS ai_material_upload_chunks (
  upload_id uuid NOT NULL REFERENCES ai_material_uploads(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position BETWEEN 0 AND 99),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 1048576),
  fingerprint text NOT NULL, PRIMARY KEY(upload_id,position)
);
