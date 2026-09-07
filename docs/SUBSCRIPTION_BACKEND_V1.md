# Subscription Backend V1

Baseline: `1ca7733cbe3fbea69070fd72cc8173ec038df399` on `main`.

## Existing architecture

The existing `subscriptions` table stores the access tier (`free` / `pro`), status,
trial and paid periods, cancellation flags, provider references and legacy grants.
`lib/subscription.ts` resolves Better Auth's server session; `evaluateSubscription`
derives access using database time. `/api/subscription` is private/no-store and
retains its response shape. Admin authorization remains independent.

Existing billing tables already cover durable account identity, trial history,
checkout intents, unique provider events, invoice/payment transactions and rate
limits. Existing payment adapters remain unregistered. No ECPay implementation,
public mutation endpoint, webhook wiring, credentials or UI changes are introduced.
Read-only inspection found one existing `pro/active` subscription.

## Files and shared plans

- `lib/subscription/plans.ts`: one catalogue for monthly (199 TWD / 1 calendar
  month), half_year (1095 / 6), yearly (2189 / 12); trial is exactly 30 days.
- `app/subscription/plans.ts`: compatibility re-export; rendered pricing unchanged.
- `lib/payment/config.ts`: existing monthly provider configuration retains its
  identifier, minor-unit conversion and environment overrides; defaults use the
  shared catalogue. Overrides must still be verified by the eventual provider.
- `lib/subscription/calendar.ts`: Taiwan calendar-month arithmetic with month-end
  clamping, including leap years. Trial arithmetic uses 30 * 24 hours instead.
- `lib/subscription/service.ts`: server-only, internal transactional commands.
- `lib/subscription-state.ts`, `lib/subscription.ts`: optional reward window and
  additive public fields `billing_plan`, `reward_start`, `reward_end`. The optional
  JSON projection works before migration too; old rows retain old behavior.
- `migrations/20260907_subscription_backend_v1.sql` and
  `scripts/migrate-subscription-v1.mjs`: additive migration, transactional dry run
  by default, validates rerun and unchanged original subscription fields.
- `tests/subscription-v1.test.mjs`: domain and isolated PostgreSQL integration tests.
  Existing subscription/payment fixture imports point to the shared catalogue.

## Database additions

| Table | Additions and constraints |
| --- | --- |
| subscriptions | Nullable `billing_plan` with three-key CHECK; nullable `reward_start`, `reward_end` with valid-window CHECK. Original `plan` and periods unchanged. |
| billing_transactions | Nullable `plan_key`, `transaction_type` (`initial` / `renewal`), each CHECK constrained. Existing integer minor-unit amounts and unique invoice/payment identities retained. |
| payment_events | Nullable `transaction_id` FK to billing_transactions. Existing `(provider,mode,provider_event_id)` UNIQUE retained. No raw payload or card data. |
| subscription_trial_history | User PK, started_at, unique binding_event_id FK. Backfills only existing trial evidence. Independent of subscription row deletion. |
| subscription_referrals | One referred account UNIQUE, immutable attribution in service; self-referral CHECK; unique trigger transaction/event FKs; pending/qualified/rewarded/invalid; one reward month; grant window/timestamps; referrer/status index. |
| subscription_operations | Unique operation key, unique event/transaction/referral FKs, account FK, type, before/after ends and timestamp; account/time index. Durable effect ledger. |

No auth/question/question-set table is altered. Migration does not remap existing
access tiers or grant any entitlement. The one existing legacy PRO remains intact.
Rollback application code first; leave additive schema in place. Do not delete
trial/payment/reward ledgers after they contain real history. A later removal
migration requires an explicit retention/export plan; no destructive down script.

## States and transitions

| Trigger | Stored transition | Access |
| --- | --- | --- |
| Verified bound payment method, eligible account | free -> trialing | Within exact trial window |
| Verified captured initial/renewal payment | trialing/expired/past_due -> active | Within paid period |
| Cancel | active/trialing + cancel_at_period_end=true | Retained until valid access ends |
| Existing provider cancellation snapshot | canceled | Retained until valid access ends |
| Verified failed renewal after prior period ended | -> past_due | No paid-period grace |
| Trial/paid period reaches exclusive end | -> expired | No base access |
| Qualified referral grant | Independent earned window | Valid during earned period, including Free users |

`cancel_at_period_end` is represented by the existing boolean (and existing
`canceled` provider state), not a new incompatible status value. Reads enforce
expiry immediately; `expireSubscription` is an optional internal persistence
operation, so access never depends on cron. A separately earned reward window is
not a payment grace period. It may provide access after base expiry, while
`nextRenewalAt` still uses only the original paid period and provider state.

## Trial and authorization boundary

`startTrial(accountId, planKey, bindingEventId)` accepts only an existing verified
`payment_method.bound` event owned by the locked billing account. It rechecks
`subscription_trial_history`, `billing_accounts.trial_started_at` and the current
subscription's trial_start in the SAME transaction as starting the trial. Event
and history unique constraints prevent replay/concurrent consumption. Deleting
the subscription row or changing plan cannot reset eligibility. Billing identity
history also survives user deletion under the existing billing foundation rules.

No browser route invokes these functions. Account IDs and normalized evidence
are internal server inputs, not user-facing authorization tokens. Any future
route must resolve the existing authenticated session and map its account on the
server. Neither `eligible=true` nor `isPro=true` nor a raw callback event name is
accepted as authorization. `server-only` prevents client bundling; it does not
replace adapter verification. Database write privileges remain a trusted boundary.

## Future adapter contract (not wired this phase)

1. Verify provider signature, account ownership and environment; fetch authoritative
   payment/binding state. Test events are rejected in Vercel production, and live
   evidence is rejected outside production.
2. Persist a sanitized payment_events record, with transaction_id for payments,
   and a billing_transactions row containing authoritative plan_key and
   transaction_type. Evidence may be recorded before entitlement processing;
   this is an inbox, not a completed entitlement. V1 completion is determined by
   subscription_operations, not the legacy event processed_at default.
3. Invoke `activateSubscription(eventId)`, `startTrial(...)`, or
   `markPaymentFailed(eventId)`. No V1 function manufactures payment evidence.
4. Retry failures. Account locks plus unique identities make committed effects
   repeat-safe. Use one orchestration path per subscription: existing snapshot
   reconciliation must NOT also increment the same payment through V1. Existing
   provider/legacy grants require an explicit migration; V1 refuses those owners.

`activateSubscription` verifies exact captured amount (integer minor units), TWD,
paid status, payment identity/time, selected plan, initial-vs-renewal order and
ownership. Partial/zero/refunded/failed payments do not grant access. It rejects
plan switching/proration. Prepaid renewals extend the end without moving an active
start into the future. Payment extension, effect ledger, first-paid history,
referral qualification and reward all commit or roll back together.

## Referral and idempotency

Referral registration locks both accounts in sorted order and is refused after
the referred account has captured payment history. Registration and trial grant
no reward. Qualification requires the initial real payment after the recorded
trial end and referral creation, with the earliest persisted capture as trigger.
The future adapter must reconcile historical payments and establish authoritative
initial/renewal identity before consumption; arrival order alone cannot prove a
provider's first payment. Refund clawback policy is deferred, not silently invented.

The referred account is UNIQUE regardless of event IDs, so alternate duplicate
notifications cannot qualify another reward. Transactions are independently UNIQUE
in the effect ledger, so different event IDs for one invoice/payment cannot extend
again. Referrer/referred account locks use consistent ordering. Grant and ledger
update share the payment transaction; deliberate grant failure rolls everything back.

Reward windows append one Taiwan calendar month after existing effective access
or previously queued reward time. Free users receive an earned window immediately.
Paid/trial end and provider renewal date are never changed by a reward. An account
with an unbounded legacy grant or detached user retains a `qualified` pending
entitlement; `grantReferralReward` can retry later without losing or duplicating it.
Future provider scheduling must separately define how reward time offsets charges;
this phase does not claim a provider's next charge has been postponed.

Cancellation records a timestamp/flag and an audit entry, never deletes a row or
refunds money. Provider-backed cancellation remains in the existing confirmed
provider workflow; V1 internal cancellation refuses to pretend it canceled remotely.

## Validation commands

```powershell
node scripts/migrate-subscription-v1.mjs          # apply twice in transaction, rollback
node scripts/migrate-subscription-v1.mjs --apply  # commit additive migration
$env:SUBSCRIPTION_DB_TEST='1'
node --test tests/subscription-v1.test.mjs
Remove-Item Env:\SUBSCRIPTION_DB_TEST
$env:PAYMENT_DB_TEST='1'
node --test tests/payment-db.test.mjs
Remove-Item Env:\PAYMENT_DB_TEST
node --test tests/subscription.test.mjs tests/payment.test.mjs tests/pdf-page-auth.test.cjs tests/system-health.test.mjs app/analysis/analytics.test.mjs
npm run build
```

PostgreSQL tests use only generated synthetic schemas, set search_path locally
inside every transaction (compatible with Neon transaction pooling), and clean up
the generated schema. They do not create fake payment evidence in public tables.
Tests cover calendar/leap boundaries, trial replay after row deletion, concurrent
same-event and alternate-event payment duplicates, reward rollback, cumulative
rewards, cancellation/expiry/failure and unchanged existing provider flows.

No live charge, ECPay signature/merchant capability, real card binding, live refund,
or interactive logged-in browser session is tested or enabled in this phase.

## Delivery validation (2026-09-07)

The additive migration was applied after its rollback dry run and repeated-run
validation. Original subscription values remained unchanged. No test users or
payment fixtures were added to public tables. Build, TypeScript and scoped ESLint
passed. All 40 tests passed: 36 existing regression tests, 2 new domain tests,
1 new concurrent PostgreSQL workflow test and 1 existing PostgreSQL payment test.
Local production HTTP checks returned 200 for fourteen public/page entrypoints;
anonymous subscription/admin APIs and billing cancellation returned 401, including
a forged isPro/userId query. Logged-in browser workflows and real payment-provider
flows were not exercised; the relevant server policy paths use automated fixtures.
