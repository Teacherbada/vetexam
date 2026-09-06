# Subscription Core V1

Verified baseline: GitHub `main`, `13f4c2af9150ae778fbdf75a56f5f455da373543`.
Neon inspection on 2026-09-06 found public.subscriptions with integer primary key,
user_id FK to Better Auth user, unique idx_subscriptions_user_id, plan/status checks,
expires_at, created_at and updated_at. No duplicate users. One active Pro had no expiry.

## Migration and deployment

Run from the repository root with DATABASE_URL configured:

```sh
node scripts/migrate-subscriptions.mjs
node scripts/migrate-subscriptions.mjs --apply
node --test tests/subscription.test.mjs
npm run build
npx tsc --noEmit
```

The first command executes DDL inside a transaction and rolls back; --apply commits.
Apply the migration BEFORE deploying code: the service requires the new columns,
and the registration subscription hook now inserts status=free. No auth tables or
login behavior change. The original unique user index and FK remain intact.
Migration errors roll back instead of deleting or merging unexpected records.
The transaction uses a five-second lock timeout. A successful rerun preserves grants.
Retain the additive schema if rolling back application code; do not remove live data.
An old application can still insert free/active; the read service normalizes it to free.

## Access policy

`getUserSubscription(headers)` and `hasProAccess(headers)` are server-only and resolve
the user exclusively through Better Auth. Reads use a parameterized Neon query and
database NOW(), with no shared user cache. Missing rows mean free; database failures
remain errors and never grant access. GET /api/subscription returns 401 when signed out,
503 on failure, private/no-store responses, and no provider IDs. There is no mutation API.

| Stored state | Pro access |
| --- | --- |
| free (or plan=free) | No |
| trialing | trial_start <= now < trial_end, both required |
| active | started, with now < current_period_end |
| past_due | No grace period in V1 |
| canceled | started, with now < current_period_end |
| expired | No |

current_period_end takes priority over the legacy expires_at fallback. Expired trials
and periods have effective status=expired at read time without a cron or a GET write;
storedStatus remains available separately. Scheduled future periods grant no access.
Never use the browser's displayed status as authorization. Admin status remains
independent: the existing PDF parser and PDF page are admin-only and untouched;
their redundant legacy Pro checks are unreachable for non-admins. Manual import's
existing Pro gate delegates to the new service without changing question handling.

Only the preexisting active Pro with NULL expiry is marked access_source=legacy_manual
on the first migration. This preserves an existing grant without making admin=Pro.
New records with no expiry receive no access. New manual/promotion/compensation grants
must have an explicit period. Do not reuse legacy_manual for new grants.
Cancellation disables renewal immediately but preserves access until the end;
missing expiry never creates perpetual canceled access. Dates are shown in Taiwan time.
nextRenewalAt requires an active provider subscription; manual grants do not imply billing.

## Extension boundaries (not implemented in V1)

Keep subscriptions as one current snapshot per user. access_source is separate from
provider; it can describe trial, payment, promotion, admin or compensation origin.
Credits must not be represented by adding 30 days to expires_at. No payment provider,
trial activation, cancellation mutation, reward issuance or credit spending ships in V1.

Before enabling payments, add a verified-provider event inbox and immutable billing
history. Validate raw-body webhook signatures and replay windows, then atomically
insert UNIQUE(provider,event_id), lock the user subscription, reconcile event ordering
against provider state, write payment/invoice history and update the snapshot.
Persist amount in minor units, currency, billing interval, invoice/payment IDs,
paid_at and refund records for MRR and trial-to-paid conversion; current snapshots
alone cannot truthfully calculate revenue or historical conversion. Persist canceled_at
and subscription transition history for new/canceled subscription reports.
Maintain expires_at in sync with current_period_end while legacy readers exist.
A browser success redirect only reads this server result and cannot activate Pro.

Future reward ledger: independent table keyed by user_id and optional subscription_id,
with source (referral/promotion/admin/compensation), amount_minor, currency, invoice_id,
unique idempotency_key, created_at and reversal_of. Issue, reserve, spend and reverse
credits transactionally with row locks; preserve ledger history rather than overwrite
balances. Credit is applied to a verified invoice, and that invoice's service period
updates subscriptions. A zero-total credited invoice does not qualify as first actual payment.

Future referral bindings must be created server-side at signup, UNIQUE(referred_user_id),
CHECK(referrer_user_id <> referred_user_id), with verified email and no retroactive binding
of old accounts. Award once only after the first verified, nonzero actual payment;
UNIQUE(qualifying_payment_id,reward_type) plus inbox idempotency prevents duplicate rewards.
Refunds reverse unused credit through linked ledger entries. Shared IP is a risk signal,
never a sole rejection criterion. Referral UI and reward tables are intentionally deferred.

Future admin counts should use the same effective expiry rules (including users without
a subscription row as Free). Keep stored states/history for audit; do not equate a raw
status='active' count with current Pro access, and never infer revenue from Pro grants.
