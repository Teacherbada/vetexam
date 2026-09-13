-- No backfill: existing questions remain unclassified (NULL).
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS chapter text NULL;
