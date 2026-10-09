-- Existing records retain their IDs, content, foreign keys and statistics.
-- Physical tables and fixed types form a boundary for ALL existing exam selectors.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'exam' CHECK (kind = 'exam');
ALTER TABLE question_answer_stats ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'exam' CHECK (kind = 'exam');
ALTER TABLE practice_attempts ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'exam' CHECK (kind = 'exam');
ALTER TABLE diagnostic_items ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'exam' CHECK (kind = 'exam');
ALTER TABLE ai_question_attempts ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'ai' CHECK (kind = 'ai');
-- ai_questions already has NOT NULL kind='ai' plus CHECK(kind='ai').
