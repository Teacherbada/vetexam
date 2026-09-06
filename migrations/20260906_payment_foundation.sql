-- Provider-neutral foundation only. No card data and no entitlement changes.
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS billing_accounts (
  id uuid PRIMARY KEY,
  user_id text UNIQUE REFERENCES "user"(id) ON DELETE SET NULL,
  identity_hash text NOT NULL UNIQUE,
  trial_started_at timestamptz,
  first_paid_at timestamptz,
  first_paid_transaction_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS billing_customers (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES billing_accounts(id),
  provider text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('test','live')),
  provider_customer_id text NOT NULL,
  UNIQUE(account_id,provider,mode),
  UNIQUE(provider,mode,provider_customer_id)
);
CREATE TABLE IF NOT EXISTS billing_checkouts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES billing_accounts(id),
  provider text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('test','live')),
  price_reference text NOT NULL,
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency = 'TWD'),
  trial_days integer NOT NULL CHECK (trial_days BETWEEN 0 AND 365),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','open','completed','synchronized','expired')),
  provider_checkout_id text,
  provider_subscription_id text,
  checkout_url text,
  return_url text NOT NULL,
  cancel_url text NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,mode,provider_checkout_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_one_open_checkout ON billing_checkouts(account_id)
  WHERE state IN ('pending','open');
CREATE TABLE IF NOT EXISTS payment_events (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('test','live')),
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  account_id uuid NOT NULL REFERENCES billing_accounts(id),
  processed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,mode,provider_event_id)
);
CREATE INDEX IF NOT EXISTS payment_events_account_time ON payment_events(account_id,created_at DESC);
CREATE TABLE IF NOT EXISTS billing_transactions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES billing_accounts(id),
  provider text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('test','live')),
  provider_invoice_id text NOT NULL,
  provider_payment_id text,
  provider_subscription_id text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  captured_minor bigint NOT NULL CHECK (captured_minor >= 0 AND captured_minor <= amount_minor),
  refunded_minor bigint NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0 AND refunded_minor <= captured_minor),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL CHECK (status IN ('pending','failed','paid','partially_refunded','refunded')),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (captured_minor = 0 OR (provider_payment_id IS NOT NULL AND paid_at IS NOT NULL)),
  UNIQUE(provider,mode,provider_invoice_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_payment_unique ON billing_transactions(provider,mode,provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS billing_transactions_account_paid ON billing_transactions(account_id,paid_at)
  WHERE captured_minor > 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='billing_accounts'::regclass AND conname='billing_first_payment_fk') THEN
    ALTER TABLE billing_accounts ADD CONSTRAINT billing_first_payment_fk FOREIGN KEY(first_paid_transaction_id) REFERENCES billing_transactions(id);
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS billing_rate_limits (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL DEFAULT now(),
  requests integer NOT NULL DEFAULT 1 CHECK (requests > 0)
);
