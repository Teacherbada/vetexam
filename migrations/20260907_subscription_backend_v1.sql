-- Additive; run after the existing subscription core and payment foundation migrations.
SET LOCAL lock_timeout = '5s';
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS billing_plan text CHECK (billing_plan IN ('monthly','half_year','yearly')),
  ADD COLUMN IF NOT EXISTS reward_start timestamptz,
  ADD COLUMN IF NOT EXISTS reward_end timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='subscriptions'::regclass AND conname='subscriptions_reward_window_check') THEN
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_reward_window_check CHECK (
      (reward_start IS NULL AND reward_end IS NULL) OR
      (reward_start IS NOT NULL AND reward_end IS NOT NULL AND reward_end > reward_start)
    );
  END IF;
END $$;
ALTER TABLE billing_transactions
  ADD COLUMN IF NOT EXISTS plan_key text CHECK (plan_key IN ('monthly','half_year','yearly')),
  ADD COLUMN IF NOT EXISTS transaction_type text CHECK (transaction_type IN ('initial','renewal'));
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS transaction_id uuid REFERENCES billing_transactions(id);
CREATE TABLE IF NOT EXISTS subscription_trial_history (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  binding_event_id uuid UNIQUE REFERENCES payment_events(id)
);
INSERT INTO subscription_trial_history(user_id,started_at)
  SELECT user_id,MIN(started_at) FROM (
    SELECT user_id,trial_start AS started_at FROM subscriptions WHERE trial_start IS NOT NULL
    UNION ALL SELECT user_id,trial_started_at FROM billing_accounts WHERE user_id IS NOT NULL AND trial_started_at IS NOT NULL
  ) history GROUP BY user_id ON CONFLICT(user_id) DO NOTHING;
CREATE TABLE IF NOT EXISTS subscription_referrals (
  id uuid PRIMARY KEY,
  referrer_account_id uuid NOT NULL REFERENCES billing_accounts(id),
  referred_account_id uuid NOT NULL UNIQUE REFERENCES billing_accounts(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','qualified','rewarded','invalid')),
  reward_months integer NOT NULL DEFAULT 1 CHECK (reward_months = 1),
  trigger_transaction_id uuid UNIQUE REFERENCES billing_transactions(id),
  trigger_event_id uuid UNIQUE REFERENCES payment_events(id),
  qualified_at timestamptz,
  reward_granted_at timestamptz,
  reward_start timestamptz,
  reward_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (referrer_account_id <> referred_account_id),
  CHECK (status NOT IN ('qualified','rewarded') OR (trigger_transaction_id IS NOT NULL AND trigger_event_id IS NOT NULL AND qualified_at IS NOT NULL)),
  CHECK (status <> 'rewarded' OR (reward_granted_at IS NOT NULL AND reward_start IS NOT NULL AND reward_end > reward_start))
);
CREATE INDEX IF NOT EXISTS subscription_referrals_referrer ON subscription_referrals(referrer_account_id,status);
CREATE TABLE IF NOT EXISTS subscription_operations (
  id uuid PRIMARY KEY,
  operation_key text NOT NULL UNIQUE,
  account_id uuid NOT NULL REFERENCES billing_accounts(id),
  operation_type text NOT NULL CHECK (operation_type IN ('trial','initial','renewal','cancel','failed','expire','referral')),
  event_id uuid UNIQUE REFERENCES payment_events(id),
  transaction_id uuid UNIQUE REFERENCES billing_transactions(id),
  referral_id uuid UNIQUE REFERENCES subscription_referrals(id),
  previous_end timestamptz,
  resulting_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_operations_account_time ON subscription_operations(account_id,created_at DESC);
