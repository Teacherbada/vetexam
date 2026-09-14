CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('official','community')),
  title TEXT NOT NULL CHECK(char_length(title) BETWEEN 1 AND 120),
  content TEXT NOT NULL CHECK(char_length(content) BETWEEN 1 AND 15000),
  subject TEXT NOT NULL,
  chapter TEXT NOT NULL CHECK(BTRIM(chapter)<>''),
  visibility TEXT NOT NULL CHECK(visibility IN ('public','private')),
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  CHECK((type='official' AND visibility='public' AND status IN ('draft','published')) OR (type='community' AND status IN ('active','hidden')))
);
CREATE TABLE IF NOT EXISTS note_helpful (
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(note_id,user_id)
);
CREATE TABLE IF NOT EXISTS note_favorites (
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(note_id,user_id)
);
CREATE INDEX IF NOT EXISTS notes_scope_idx ON notes(subject,chapter,type,status,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS notes_author_idx ON notes(author_id,updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS note_favorites_user_idx ON note_favorites(user_id,note_id);
