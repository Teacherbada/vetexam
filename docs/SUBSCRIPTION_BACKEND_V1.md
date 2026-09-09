# Subscription Backend V1

Current trial revision baseline: `main`, `6f4b39c3dd0c9e9af8a695232e9a27ecf8eb60a4` (2026-09-09).
Trial is granted automatically to eligible newly registered users.
No payment method is required. Trial expires after exactly 30 days.
Expiration does not trigger automatic billing. Paid billing begins only after
the user explicitly subscribes and completes payment. No database schema changes.

Trial revision changed files:

- `lib/auth.ts`, `lib/subscription/service.ts`
- `lib/payment/config.ts`, `lib/payment/service.ts`, `lib/payment/view.ts`, `lib/payment/types.ts`
- `app/subscription/page.tsx`, `app/subscription/Pricing.tsx`, `app/subscription/PlanInformation.tsx`
- `app/subscription/AccountStatus.tsx`, `app/subscription/BillingActions.tsx`
- `app/subscription-info/page.tsx`, `app/refund-policy/page.tsx`
- `tests/subscription-v1.test.mjs`, `tests/subscription.test.mjs`, `tests/payment.test.mjs`, `tests/payment-db.test.mjs`
- `docs/SUBSCRIPTION_BACKEND_V1.md`, `docs/PAYMENT_INTEGRATION_V1.md`

Validation for this trial revision: 39 unit/render/auth/admin/PDF/analytics tests
and both PostgreSQL integration workflows passed (41 distinct tests total).
The database tests only used generated synthetic schemas and cleaned up their
fixtures; no public schema migration or existing-user grants were performed.
Build (including TypeScript), scoped ESLint and diff whitespace checks passed.
Full `npm run lint` failed on pre-existing code and `.security-audit` generated
artifacts (866 errors, 11071 warnings); those unrelated files were not changed.
Fifteen local production page entrypoints returned 200, including login/register,
subscription/account, policy pages, admin, subjects/questions, analysis, wrong,
favorites, PDF and feedback. Anonymous subscription/admin APIs returned 401,
including forged entitlement query flags. Quiz without selection returned its
expected 400. This is HTTP/render regression coverage, not a complete logged-in
interactive browser or live-payment acceptance test. Existing UI styles and
the user's unrelated pending working-tree edits were preserved.

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
| Successful new-user registration, eligible account | free -> trialing | Within exact trial window |
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

The existing Better Auth user-create after hook first preserves a Free fallback,
then invokes `startTrialForNewUser(userId)`. It is never invoked on login, reads,
deployment or checkout. Existing users receive no automatic grants. The helper
locks the subscription row and atomically writes the existing permanent
`subscription_trial_history` and the exact database-time 30-day window. The
history primary key and row lock prevent replay/concurrent extension, even after
subscription-row deletion. No billing account, provider, card, plan selection,
payment event or transaction is needed; `billing_plan` remains null.

`startTrial(accountId)` remains an internal helper for eligible billing accounts;
it also checks billing-account trial/first-paid history and captured transactions,
and updates the existing billing history and operation ledger. No binding event is
required. Neither path sets first-paid fields or awards referrals.

If trial creation fails, the transaction rolls back and the hook logs a server
error. Registration remains usable with Free access. Repair is an explicit
server operation: verify that the user was newly registered under this revision
and had a failed grant before retrying `startTrialForNewUser`; never bulk-repair
legacy Free users. There is no automatic login/read repair or backfill.
Trial expiry only removes access; learning records remain intact.

No browser route invokes these functions. Account IDs and normalized evidence
are internal server inputs, not user-facing authorization tokens. Any future
route must resolve the existing authenticated session and map its account on the
server. Neither `eligible=true` nor `isPro=true` nor a raw callback event name is
accepted as authorization. `server-only` prevents client bundling; it does not
replace adapter verification. Database write privileges remain a trusted boundary.

## Future adapter contract (not wired this phase)

1. Verify provider signature, account ownership and environment; fetch authoritative
   payment state. Test events are rejected in Vercel production, and live
   evidence is rejected outside production or without the existing
   `PAYMENT_LIVE_CONFIRMED=true` confirmation. This phase does not set that flag.
2. Persist a sanitized payment_events record, with transaction_id for payments,
   and a billing_transactions row containing authoritative plan_key and
   transaction_type. Evidence may be recorded before entitlement processing;
   this is an inbox, not a completed entitlement. V1 completion is determined by
   subscription_operations, not the legacy event processed_at default.
3. Invoke `activateSubscription(eventId)` or
   `markPaymentFailed(eventId)`. No V1 function manufactures payment evidence.
4. Retry failures. Account locks plus unique identities make committed effects
   repeat-safe. Use one orchestration path per subscription: existing snapshot
   reconciliation must NOT also increment the same payment through V1. Existing
   provider/legacy grants require an explicit migration; V1 refuses those owners.

`activateSubscription` verifies exact captured amount (integer minor units), TWD,
paid status, payment identity/time, selected plan, initial-vs-renewal order and
ownership. Partial/zero/refunded/failed payments do not grant access. It rejects
plan switching/proration, pre-trial-end initial captures, out-of-order historical
captures, and renewals from a different provider/mode/subscription identity.
Those cases require explicit reconciliation, not speculative entitlement updates.
Prepaid renewals extend the end without moving an active
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

In the internal V1 flow, a later paid extension starts after the greater of the
existing paid end, current earned-access end, and verified payment time. This
preserves already earned time instead of overlapping it with a new paid month.
For an active reward-only user, the combined access window begins no later than
payment time so a further referral sees the complete effective end. The existing
reward ledger keeps its original grant interval for audit. Only the subsequent
verified payment updates the combined subscription period; granting a reward by
itself still does not change a provider's renewal date.

Continuous calendar renewals retain their original day across February (Jan 31 ->
Feb 28 -> Mar 31). Calendar gaps or reward offsets use the resulting extension
boundary. Calendar-month duration is distinct from the exact 30-day trial.

Cancellation records a timestamp/flag and an audit entry, never deletes a row or
refunds money. Provider-backed cancellation remains in the existing confirmed
provider workflow; V1 internal cancellation refuses to pretend it canceled remotely.
Internal cancellation also requires an unexpired V1-owned term. It cannot disable
an unbounded legacy grant. Optional expiry writes are likewise limited to V1-owned,
non-provider subscriptions; existing readers continue enforcing expiry everywhere.

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

## Follow-up validation and delivery (2026-09-08)

Inspected baseline: `77aa975f555b6540beb454be327571670292feab` on `main`.
V1 schema was already applied. Read-only public-table inspection found one active
`legacy_manual` PRO, zero payment events, zero operations and zero referrals.
This follow-up adds no tables, columns, indexes or constraints. The existing
additive migration was run twice in a rollback transaction; existing subscription
values remained unchanged. No real accounts receive test events or rewards.

Changed files in this follow-up:

- `lib/subscription/service.ts`: preserve earned time across payments, validate
  renewal identity/order, reject early initial capture and previously paid trial
  applicants, require live confirmation, protect existing grants from V1 commands.
- `lib/subscription/calendar.ts`: retain calendar billing anchor after month-end
  clamping; reject invalid period lengths.
- `tests/subscription-v1.test.mjs`: cover those cases, including payment after
  reward-only access, a later referral, and concurrent renewal.
- This architecture and validation document.

Existing trial, referral and operation tables retain their unique protections.
Trial checks additionally consult durable first-paid history and captured
transactions, so previously paid accounts do not receive a first-subscription trial.
No UI, authentication, API route, provider adapter, payment webhook, environment
setting or question data changes are part of this follow-up.

Final validation: all 40 tests passed (36 existing regressions, 2 calendar/access
tests, the expanded concurrent V1 PostgreSQL workflow, and the existing payment
PostgreSQL workflow). Build, TypeScript, scoped ESLint and whitespace checks passed.
Fourteen local production page entrypoints returned HTTP 200. Anonymous subscription
requests, including forged `isPro`/user IDs, returned 401; admin users returned 403;
the unchanged billing cancellation endpoint returned 401. These checks do not
claim a real card charge or an interactive logged-in browser workflow was tested.
