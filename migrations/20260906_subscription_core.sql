-- Extend the inspected public.subscriptions table; never create a parallel table.
-- The runner wraps this file in a transaction and rolls back on any error.
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.subscriptions IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT user_id FROM public.subscriptions GROUP BY user_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate subscription users; inspect before migrating';
  END IF;
  -- One-time provenance backfill. Rerunning must never grant new unbounded access.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
    AND table_name = 'subscriptions' AND column_name = 'access_source') THEN
    ALTER TABLE public.subscriptions ADD COLUMN access_source text;
    UPDATE public.subscriptions SET access_source = 'legacy_manual'
      WHERE plan = 'pro' AND status = 'active' AND expires_at IS NULL;
  END IF;
END $$;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS trial_start timestamptz,
  ADD COLUMN IF NOT EXISTS trial_end timestamptz,
  ADD COLUMN IF NOT EXISTS current_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_customer_id text,
  ADD COLUMN IF NOT EXISTS provider_subscription_id text;

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
UPDATE public.subscriptions SET status = 'canceled' WHERE status = 'cancelled';
UPDATE public.subscriptions SET status = 'free' WHERE plan = 'free' AND status = 'active';
UPDATE public.subscriptions SET current_period_end = expires_at
  WHERE current_period_end IS NULL AND expires_at IS NOT NULL;
ALTER TABLE public.subscriptions ALTER COLUMN status SET DEFAULT 'free';
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('free', 'trialing', 'active', 'past_due', 'canceled', 'expired'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.subscriptions'::regclass AND conname = 'subscriptions_period_check') THEN
    ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_period_check CHECK (
      (trial_start IS NULL OR trial_end IS NULL OR trial_end > trial_start) AND
      (current_period_start IS NULL OR current_period_end IS NULL OR current_period_end > current_period_start)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.subscriptions'::regclass AND conname = 'subscriptions_trial_check') THEN
    ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_trial_check CHECK (
      status <> 'trialing' OR (plan = 'pro' AND trial_start IS NOT NULL AND trial_end IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.subscriptions'::regclass AND conname = 'subscriptions_provider_check') THEN
    ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_provider_check CHECK (
      (provider_subscription_id IS NULL AND provider_customer_id IS NULL) OR provider IS NOT NULL
    );
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_provider_subscription_unique
  ON public.subscriptions(provider, provider_subscription_id) WHERE provider_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS subscriptions_period_end_idx ON public.subscriptions(current_period_end);

CREATE OR REPLACE FUNCTION public.subscription_core_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS subscription_core_updated_at ON public.subscriptions;
CREATE TRIGGER subscription_core_updated_at BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.subscription_core_updated_at();
