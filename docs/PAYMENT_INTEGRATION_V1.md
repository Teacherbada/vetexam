# Payment Integration V1 — provider-neutral foundation

## Delivery status

The owner has not selected a payment provider. Trial duration is confirmed as **30 days**.
This revision implements and tests provider-neutral billing workflows, storage and UI.
It is **not a live payment integration**. No real adapter, API credentials, hosted
checkout session, provider signature algorithm or sandbox end-to-end charge is installed.
The provider registry is empty and all payment mutation/webhook routes fail closed.
PAYMENT_ENABLED=true alone cannot activate payments. Test adapters exist only in tests.

Baseline: GitHub main `4d84c80aa15df1b1de1d275bcce1336045b5930f`.
Neon was inspected before editing: only Subscription Core tables/columns existed,
and no local payment environment variable names or payment SDKs were present.

## Changed files

| Path | Change and purpose |
| --- | --- |
| app/subscription/page.tsx | Central monthly price and 30-day trial disclosure, provider-gated actions, existing visual design |
| app/subscription/subscription.module.css | Price, action spacing and return card styles scoped to subscription |
| tests/subscription.test.mjs | Update existing page fixtures for billing components while retaining access/admin regressions |

## New files

| Path | Purpose |
| --- | --- |
| lib/payment/types.ts | Provider contract: hosted checkout, customer recovery, subscription, payment, portal, verified events |
| lib/payment/config.ts | Single source of monthly amount, trial days, origin, mode and production activation |
| lib/payment/provider.ts | Empty fail-closed adapter registry pending merchant selection |
| lib/payment/policy.ts | Validate provider ownership, hosted URL origins, trial bounds, captured funds and refunds |
| lib/payment/db.ts | Bounded PostgreSQL transactions and locks |
| lib/payment/events.ts | Transactional event deduplication and fresh provider reconciliation; historical refunds do not replace current subscription |
| lib/payment/service.ts | Durable checkout intent/customer reuse, permanent trial history, subscription mutations, event and invoice persistence |
| lib/payment/http.ts | Better Auth session, same-origin POST guard, rate control, safe errors, raw bounded webhook input |
| lib/payment/view.ts | Read billing presentation from Neon without provider network requests on page loads |
| app/api/billing/checkout/route.ts | Authenticated server-controlled Checkout entry |
| app/api/billing/cancel/route.ts | Cancel at period end using server-resolved provider subscription ID |
| app/api/billing/resume/route.ts | Resume only when the chosen provider supports it |
| app/api/billing/portal/route.ts | Provider-hosted payment method and invoice management |
| app/api/billing/sync/route.ts | Explicit rate-limited reconciliation; not called on page loads |
| app/api/billing/webhook/route.ts | Raw-body entry; verification must succeed before database writes |
| app/subscription/BillingActions.tsx | Disabled-during-operation buttons, cancellation confirmation and visible errors |
| app/subscription/RefreshSubscription.tsx | Loading-aware server refresh |
| app/subscription/return/page.tsx | Reads actual server entitlement; ignores success/query flags |
| migrations/20260906_payment_foundation.sql | Six billing tables, indexes and constraints; no modification to existing subscription data |
| scripts/migrate-payment.mjs | Transactional dry-run by default; --apply commits |
| tests/payment.test.mjs | Policy, environment, ownership, event, refund and HTTP guard tests |
| tests/payment-db.test.mjs | Opt-in real PostgreSQL workflows in a temporary test schema; always rolled back |
| docs/PAYMENT_INTEGRATION_V1.md | This implementation/status and configuration report |

## Database

The migration adds no columns to Better Auth user or the existing subscriptions table.

* billing_accounts: durable identity hash, nullable user FK (SET NULL on account deletion),
  trial_started_at, first_paid_at and first_paid_transaction_id (FK). Unique user and identity hash. The HMAC key must remain
  stable. A deleted account's billing history is not reset; reassociation requires verified
  email. Do not rotate the key without a planned identity migration.
* billing_customers: account/provider/test-or-live mapping; unique account+provider+mode
  and provider+mode+customer ID. Recovery is an adapter requirement, not repeated blind creates.
* billing_checkouts: frozen price/trial/return URLs and durable idempotency ID, provider IDs,
  pending/open/completed/synchronized/expired state. Partial unique index allows only one
  outstanding pending/open attempt per account. Completed-unsynchronized checkouts block retries.
* payment_events: unique provider+mode+event ID, event type and processing timestamps.
  Event insertion and subscription/payment updates commit in the SAME transaction.
* billing_transactions: unique invoice and non-null payment IDs scoped to provider/mode,
  captured amount, refunded amount, currency, payment status and dates. No raw payloads/card data.
* billing_rate_limits: one row per user, ten billing requests per minute, shared across actions.

Trial is consumed when the server confirms a provider trial, not when a button is clicked.
Canceled/expired subscriptions never reset trial history. Actual captured money (>0 with
a provider payment identifier and paid_at) establishes first_paid_at; zero invoices and
credits do not. MIN(paid_at) handles out-of-order invoices; refunds preserve historical first
payment while recording refundable amounts/status. No referral award is implemented.
First-paid attribution is eventually reconciled; a future reward job must account for delayed
earlier invoices and refunds, rather than issue rewards from the browser or a raw event name.

```powershell
node scripts/migrate-payment.mjs          # dry run / rollback
node scripts/migrate-payment.mjs --apply  # apply only the billing schema
$env:PAYMENT_DB_TEST='1'
node --test tests/payment-db.test.mjs     # creates a generated schema in a transaction; rolls back
Remove-Item Env:\PAYMENT_DB_TEST
```

## Environment variables

Never paste secret values in chat, source control, logs or browser props.

| Variable | Local / Preview | Vercel Production | Source |
| --- | --- | --- | --- |
| PAYMENT_ENABLED | false until a tested adapter is installed | false until launch validation | Deployment setting |
| PAYMENT_PROVIDER | Unset until selection | Same chosen adapter | Merchant selection |
| PAYMENT_MODE | test | live only after launch validation | Deployment setting |
| PAYMENT_LIVE_CONFIRMED | Unset | true only for validated live launch | Explicit operator setting |
| BILLING_APP_ORIGIN | http://localhost:3000 or exact HTTPS Preview origin | https://vetexam-tw.vercel.app (or the actual canonical domain) | Existing site URL; no trailing slash |
| PAYMENT_PRICE_ID | Sandbox monthly recurring price reference | Separate live recurring price reference | Provider product/price dashboard |
| PRO_MONTHLY_AMOUNT_MINOR | 19900 (TWD minor units, NT$199) | 19900 | Central price config |
| PRO_TRIAL_DAYS | 30 | 30 | Owner-confirmed trial duration |
| BILLING_IDENTITY_SECRET | Independently generated 32+ character secret | Separate stable production secret | Password/secret manager |
| DATABASE_URL | Isolated test/Preview Neon database | Existing production Neon database | Neon dashboard |
| Provider API secret / Webhook secret | Names depend on chosen adapter | Separate live secrets | Provider API keys and webhook dashboard |

There is deliberately no NEXT_PUBLIC payment secret. Hosted Checkout requires no local
card form. API keys and webhook signing secrets are not yet named/consumed by any adapter;
finalize those names after selection rather than pretending an unused variable activates billing.
Live mode is rejected outside Vercel production or without PAYMENT_LIVE_CONFIRMED=true.
Enabled test mode is rejected on the production deployment. Preview must use its own DB.

## Required provider/dashboard work (pending selection)

1. Confirm merchant country/entity eligibility and support for TWD recurring payments.
2. Create separate sandbox and live Pro **monthly** products/prices; no annual plan.
3. Configure Hosted Checkout to always collect a valid payment method before a 30-day trial.
   Terms and price are supplied/verified server-side, never browser parameters.
4. Configure an exact HTTPS return URL `/subscription/return` and cancellation URL `/subscription`.
5. Register `/api/billing/webhook` (or an adapter-specific route if the provider requires a
   different acknowledgement format). Implement that provider's raw signature and timestamp
   validation with the official SDK. Subscribe to checkout/subscription/trial updates,
   paid/failed invoices and partial/full refunds using its actual event names.
6. Enable the official customer portal for payment methods, billing information and invoices.
7. Verify durable customer/Checkout recovery after lost responses, idempotency key retention,
   duplicate subscriptions, cancellation scheduling, resume support and subscription retrieval
   after terminal deletion. All provider calls must enforce a timeout shorter than 15 seconds.
8. Register the adapter only after its contract and real Sandbox lifecycle tests pass.

## Validation and remaining limits

2026-09-06 results: build, standalone TypeScript and scoped ESLint passed. 29 unit/UI/
Admin regression tests passed, plus 1 PostgreSQL lifecycle integration test (30 total).
The migration passed a rollback dry run and was applied to Neon; existing subscription
rows were not modified. Local production HTTP smoke tests returned 401 for all five
anonymous billing actions, 503 for the unconfigured webhook, and 200 for the subscription
and return pages. A forged success=true/isPro=true URL did not authorize membership.

The tests distinguish simulated provider contracts from real provider tests. Unit tests
cover configuration, fail-closed behavior, URL/ownership checks, trial card binding, duplicate
events, delayed updates and refund policy. The isolated PostgreSQL test exercises durable
Checkout reuse, trial consumption, signature-failure rejection before writes (mock verifier),
event duplicates, cancel/resume idempotent outcomes, transaction rollback on invoice failure,
first captured payment and refund retention. Existing Subscription Core and Admin/PDF tests
remain in the regression set. Build, TypeScript and focused lint must pass before delivery.

**Not tested/implemented yet:** real Checkout or card binding, actual signature cryptography,
automatic provider scheduling/charges, live refunds and provider portal. Those require the
provider adapter and sandbox credentials. The six API routes intentionally return unavailable
instead of manufacturing success. Provider selection is the remaining external dependency.

No auth/admin/PDF/question/review/home behavior is changed. Referral and rewards remain deferred.
