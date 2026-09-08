import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { billingTransaction } from "@/lib/payment/db";
import { evaluateSubscription, type SubscriptionRecord } from "@/lib/subscription-state";
import { addCalendarMonths, nextCalendarPeriodEnd } from "./calendar";
import { subscriptionPlan, TRIAL_DAYS, type SubscriptionPlan } from "./plans";

// Internal trusted service only: no HTTP entry, no browser-supplied success/eligibility.
// Future adapters must verify and persist evidence before invoking these operations.
type Account = { id: string; user_id: string | null; trial_started_at: Date | null; first_paid_at: Date | null };
type Row = SubscriptionRecord & { billing_plan: SubscriptionPlan | null; reward_start: string | null; reward_end: string | null };
function assertEventEnvironment(mode: string) {
  if (!["test", "live"].includes(mode) || (mode === "test" && process.env.VERCEL_ENV === "production") ||
    (mode === "live" && (process.env.VERCEL_ENV !== "production" || process.env.PAYMENT_LIVE_CONFIRMED !== "true"))) throw new Error("Payment environment mismatch");
}
async function now(client: PoolClient): Promise<Date> {
  return (await client.query("SELECT transaction_timestamp() AS time")).rows[0].time;
}
async function lockAccounts(client: PoolClient, ids: string[]): Promise<Account[]> {
  const rows = (await client.query<Account>("SELECT * FROM billing_accounts WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE", [ids])).rows;
  if (rows.length !== new Set(ids).size) throw new Error("Billing account not found");
  return rows;
}
async function subscription(client: PoolClient, userId: string): Promise<Row> {
  await client.query("INSERT INTO subscriptions(user_id,plan,status) VALUES($1,'free','free') ON CONFLICT(user_id) DO NOTHING", [userId]);
  // JSON serializes pg timestamptz consistently with the existing string-based access evaluator.
  return (await client.query("SELECT row_to_json(s) AS record FROM subscriptions s WHERE user_id=$1 FOR UPDATE", [userId])).rows[0].record;
}
async function eligible(client: PoolClient, account: Account) {
  if (!account.user_id || account.trial_started_at || account.first_paid_at) return false;
  return !(await client.query(`SELECT 1 FROM subscription_trial_history WHERE user_id=$1
    UNION ALL SELECT 1 FROM subscriptions WHERE user_id=$1 AND trial_start IS NOT NULL
    UNION ALL SELECT 1 FROM billing_transactions WHERE account_id=$2 AND captured_minor>0`, [account.user_id, account.id])).rowCount;
}
export async function isEligibleForTrial(accountId: string) {
  return billingTransaction(async client => eligible(client, (await lockAccounts(client, [accountId]))[0]));
}
async function audit(client: PoolClient, accountId: string, key: string, type: string, details: {
  eventId?: string; transactionId?: string; referralId?: string; before?: string | null; after?: string | null;
} = {}) {
  await client.query(`INSERT INTO subscription_operations(id,operation_key,account_id,operation_type,event_id,transaction_id,referral_id,previous_end,resulting_end)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [randomUUID(), key, accountId, type, details.eventId ?? null,
    details.transactionId ?? null, details.referralId ?? null, details.before ?? null, details.after ?? null]);
}
async function duplicate(client: PoolClient, key: string, accountId: string) {
  const row = (await client.query("SELECT account_id FROM subscription_operations WHERE operation_key=$1", [key])).rows[0];
  if (row && row.account_id !== accountId) throw new Error("Operation ownership mismatch");
  return Boolean(row);
}

export async function startTrial(accountId: string, planKey: SubscriptionPlan, bindingEventId: string) {
  const plan = subscriptionPlan(planKey);
  return billingTransaction(async client => {
    const account = (await lockAccounts(client, [accountId]))[0];
    const key = `trial:${bindingEventId}`;
    if (await duplicate(client, key, accountId)) return { duplicate: true };
    const event = (await client.query("SELECT * FROM payment_events WHERE id=$1 AND account_id=$2 FOR UPDATE", [bindingEventId, accountId])).rows[0];
    if (!event || event.event_type !== "payment_method.bound") throw new Error("Verified binding evidence required");
    assertEventEnvironment(event.mode);
    if (!await eligible(client, account)) throw new Error("Trial already used or account unavailable");
    const sub = await subscription(client, account.user_id!);
    const time = await now(client);
    if (evaluateSubscription(sub, time).hasProAccess || sub.provider_subscription_id) throw new Error("Existing subscription must be resolved first");
    const end = new Date(time.getTime() + TRIAL_DAYS * 86400000);
    await client.query("INSERT INTO subscription_trial_history(user_id,started_at,binding_event_id) VALUES($1,$2,$3)", [account.user_id, time, event.id]);
    await client.query("UPDATE billing_accounts SET trial_started_at=COALESCE(trial_started_at,$2) WHERE id=$1", [accountId, time]);
    await client.query(`UPDATE subscriptions SET plan='pro',billing_plan=$2,status='trialing',trial_start=$3,trial_end=$4,
      current_period_start=$3,current_period_end=$4,expires_at=$4,cancel_at_period_end=false,canceled_at=null,access_source='subscription_v1'
      WHERE user_id=$1`, [account.user_id, plan.key, time, end]);
    await audit(client, accountId, key, "trial", { eventId: event.id, after: end.toISOString() });
    return { duplicate: false };
  });
}

export async function registerReferral(referrerId: string, referredId: string) {
  if (referrerId === referredId) throw new Error("Self referral forbidden");
  return billingTransaction(async client => {
    const accounts = await lockAccounts(client, [referrerId, referredId]);
    if (accounts.some(account => !account.user_id)) throw new Error("Referral requires existing users");
    const existing = (await client.query("SELECT * FROM subscription_referrals WHERE referred_account_id=$1", [referredId])).rows[0];
    if (existing) {
      if (existing.referrer_account_id !== referrerId) throw new Error("Referral attribution is immutable");
      return { id: existing.id, duplicate: true };
    }
    if ((await client.query("SELECT 1 FROM billing_transactions WHERE account_id=$1 AND captured_minor>0", [referredId])).rowCount) throw new Error("Cannot refer an already paid account");
    const id = randomUUID();
    await client.query("INSERT INTO subscription_referrals(id,referrer_account_id,referred_account_id) VALUES($1,$2,$3)", [id, referrerId, referredId]);
    return { id, duplicate: false };
  });
}

async function grantReward(client: PoolClient, referralId: string, time: Date) {
  const referral = (await client.query("SELECT * FROM subscription_referrals WHERE id=$1 FOR UPDATE", [referralId])).rows[0];
  if (!referral || referral.status !== "qualified") return;
  const account = (await client.query<Account>("SELECT * FROM billing_accounts WHERE id=$1", [referral.referrer_account_id])).rows[0];
  if (!account?.user_id) return; // Durable qualified entitlement survives a deleted referrer's user.
  const sub = await subscription(client, account.user_id);
  const access = evaluateSubscription(sub, time);
  if (access.hasProAccess && !access.accessUntil) return; // Preserve an unbounded legacy grant; keep reward pending.
  const start = new Date(Math.max(time.getTime(), Date.parse(access.accessUntil ?? "") || 0,
    sub.reward_start && sub.reward_end && Date.parse(sub.reward_end) > Date.parse(sub.reward_start) ? Date.parse(sub.reward_end) : 0));
  const end = addCalendarMonths(start, referral.reward_months);
  // Reward time is independent of paid/trial dates. Never postpone a provider charge by guessing.
  const rewardStart = sub.reward_start && sub.reward_end && Date.parse(sub.reward_end) >= start.getTime() ? sub.reward_start : start.toISOString();
  await client.query("UPDATE subscriptions SET reward_start=$2,reward_end=$3 WHERE user_id=$1", [account.user_id, rewardStart, end]);
  await client.query(`UPDATE subscription_referrals SET status='rewarded',reward_granted_at=$2,reward_start=$3,reward_end=$4,updated_at=$2 WHERE id=$1`, [referralId, time, start, end]);
  await audit(client, account.id, `referral:${referralId}`, "referral", { referralId, before: access.accessUntil, after: end.toISOString() });
}

/** Consume only normalized evidence persisted by a trusted adapter, never a request body.
 * Existing provider reconciliation remains untouched and MUST NOT also extend this payment.
 */
export async function activateSubscription(eventId: string) {
  return billingTransaction(async client => {
    const lookup = (await client.query("SELECT account_id FROM payment_events WHERE id=$1", [eventId])).rows[0];
    if (!lookup) throw new Error("Verified payment event required");
    const relationship = (await client.query("SELECT id,referrer_account_id FROM subscription_referrals WHERE referred_account_id=$1", [lookup.account_id])).rows[0];
    const ids = relationship ? [lookup.account_id, relationship.referrer_account_id] : [lookup.account_id];
    const accounts = await lockAccounts(client, ids);
    // Registration also locks the referred account. If attribution changed while waiting, retry safely.
    const referral = (await client.query("SELECT * FROM subscription_referrals WHERE referred_account_id=$1", [lookup.account_id])).rows[0];
    if (referral && !accounts.some(a => a.id === referral.referrer_account_id)) throw new Error("Referral changed; retry transaction");
    const account = accounts.find(a => a.id === lookup.account_id)!;
    if (!account.user_id) throw new Error("Payment account unavailable");
    const event = (await client.query("SELECT * FROM payment_events WHERE id=$1 FOR UPDATE", [eventId])).rows[0];
    assertEventEnvironment(event.mode);
    const payment = (await client.query("SELECT * FROM billing_transactions WHERE id=$1 FOR UPDATE", [event.transaction_id])).rows[0];
    if (!payment || payment.account_id !== account.id || payment.provider !== event.provider || payment.mode !== event.mode || event.event_type !== "payment.succeeded") throw new Error("Payment provenance mismatch");
    const key = `payment:${payment.id}`;
    if (await duplicate(client, key, account.id)) return { duplicate: true };
    const plan = subscriptionPlan(payment.plan_key);
    const amount = plan.price * 100;
    const time = await now(client);
    if (payment.status !== "paid" || Number(payment.amount_minor) !== amount || Number(payment.captured_minor) !== amount || Number(payment.refunded_minor) !== 0 ||
      payment.currency !== "TWD" || !payment.provider_payment_id || !payment.provider_subscription_id || !(payment.paid_at instanceof Date) || !Number.isFinite(payment.paid_at.getTime()) || payment.paid_at > time || !["initial","renewal"].includes(payment.transaction_type)) throw new Error("Successful real payment required");
    const sub = await subscription(client, account.user_id);
    if (sub.billing_plan && sub.billing_plan !== plan.key) throw new Error("Plan changes are not supported in V1");
    if (sub.provider_subscription_id && (sub.provider_subscription_id !== payment.provider_subscription_id || sub.provider !== payment.provider)) throw new Error("Historical subscription payment cannot extend current access");
    const previousPayment = (await client.query(`SELECT p.provider,p.mode,p.provider_subscription_id,p.paid_at
      FROM subscription_operations o JOIN billing_transactions p ON p.id=o.transaction_id
      WHERE o.account_id=$1 AND o.operation_type IN ('initial','renewal') ORDER BY p.paid_at DESC,p.id LIMIT 1`, [account.id])).rows[0];
    if ((payment.transaction_type === "initial" && previousPayment) || (payment.transaction_type === "renewal" && !previousPayment)) throw new Error("Unexpected payment order");
    if (previousPayment && (previousPayment.provider !== payment.provider || previousPayment.mode !== payment.mode || previousPayment.provider_subscription_id !== payment.provider_subscription_id)) throw new Error("Payment subscription identity mismatch");
    if (previousPayment && payment.paid_at < previousPayment.paid_at) throw new Error("Historical payment requires reconciliation");
    if (sub.access_source && !["subscription_v1"].includes(sub.access_source)) throw new Error("Existing provider or legacy subscription requires explicit migration");
    if (payment.transaction_type === "initial" && sub.trial_end && payment.paid_at.getTime() < Date.parse(sub.trial_end)) throw new Error("Trial has not ended");
    const access = evaluateSubscription(sub, time);
    // Consume the existing effective end, including earned time. A new paid period must
    // not overlap and silently swallow a previously granted referral extension.
    const start = new Date(Math.max(payment.paid_at.getTime(), Date.parse(sub.current_period_end ?? "") || 0, Date.parse(access.accessUntil ?? "") || 0));
    const continuesPaidPeriod = Boolean(previousPayment && sub.current_period_end && start.getTime() === Date.parse(sub.current_period_end));
    const end = nextCalendarPeriodEnd(start, plan.months, continuesPaidPeriod && sub.current_period_start ? new Date(sub.current_period_start) : null);
    // An already active reward-only user retains continuous access. Represent the
    // combined period from its existing start/payment time, not a future paid start.
    const effectiveStart = access.hasProAccess
      ? new Date(Math.min(Date.parse(sub.current_period_start ?? "") || payment.paid_at.getTime(), payment.paid_at.getTime())) : start;
    await client.query(`UPDATE subscriptions SET plan='pro',billing_plan=$2,status='active',current_period_start=$3,
      current_period_end=$4,expires_at=$4,access_source='subscription_v1' WHERE user_id=$1`, [account.user_id, plan.key, effectiveStart, end]);
    await audit(client, account.id, key, payment.transaction_type, { eventId, transactionId: payment.id, before: sub.current_period_end, after: end.toISOString() });
    await client.query(`UPDATE billing_accounts SET first_paid_at=(SELECT MIN(paid_at) FROM billing_transactions
      WHERE account_id=$1 AND mode=$2 AND captured_minor>0),first_paid_transaction_id=(SELECT id FROM billing_transactions
      WHERE account_id=$1 AND mode=$2 AND captured_minor>0 ORDER BY paid_at,id LIMIT 1) WHERE id=$1`, [account.id, payment.mode]);
    if (referral?.status === "pending" && payment.transaction_type === "initial" && payment.paid_at >= referral.created_at && sub.trial_end && payment.paid_at.getTime() >= Date.parse(sub.trial_end)) {
      // A delayed older transaction must not qualify a later payment as the first one.
      const first = (await client.query(`SELECT id FROM billing_transactions WHERE account_id=$1 AND mode=$2 AND captured_minor>0 ORDER BY paid_at,id LIMIT 1`, [account.id, payment.mode])).rows[0];
      if (first?.id === payment.id) {
        await client.query(`UPDATE subscription_referrals SET status='qualified',trigger_transaction_id=$2,trigger_event_id=$3,qualified_at=$4,updated_at=$4 WHERE id=$1`, [referral.id, payment.id, eventId, time]);
        await grantReward(client, referral.id, time);
      }
    }
    return { duplicate: false };
  });
}

export async function grantReferralReward(referralId: string) {
  return billingTransaction(async client => {
    const referral = (await client.query("SELECT * FROM subscription_referrals WHERE id=$1", [referralId])).rows[0];
    if (!referral) throw new Error("Referral not found");
    await lockAccounts(client, [referral.referrer_account_id, referral.referred_account_id]);
    await grantReward(client, referralId, await now(client));
  });
}

export async function cancelAtPeriodEnd(accountId: string, requestId: string) {
  if (!requestId || requestId.length > 200) throw new Error("Stable request identity required");
  return billingTransaction(async client => {
    const account = (await lockAccounts(client, [accountId]))[0];
    if (!account.user_id) throw new Error("Account unavailable");
    const key = `cancel:${accountId}:${requestId}`;
    if (await duplicate(client, key, accountId)) return;
    const sub = await subscription(client, account.user_id);
    // Provider-backed cancellation must continue through the existing provider-confirmed flow.
    if (sub.provider_subscription_id) throw new Error("Use provider-confirmed cancellation");
    if (sub.access_source !== "subscription_v1") throw new Error("Existing subscription requires explicit migration");
    const baseEnd = sub.status === "trialing" ? sub.trial_end : sub.current_period_end;
    if (!baseEnd || !Number.isFinite(Date.parse(baseEnd)) || Date.parse(baseEnd) <= (await now(client)).getTime()) throw new Error("No unexpired subscription to cancel");
    if (!sub.cancel_at_period_end) {
      if (!["active","trialing"].includes(sub.status)) throw new Error("No subscription to cancel");
      await client.query("UPDATE subscriptions SET cancel_at_period_end=true,canceled_at=now() WHERE user_id=$1", [account.user_id]);
    }
    await audit(client, accountId, key, "cancel", { before: sub.current_period_end, after: sub.current_period_end });
  });
}

export async function markPaymentFailed(eventId: string) {
  return billingTransaction(async client => {
    const event = (await client.query("SELECT * FROM payment_events WHERE id=$1", [eventId])).rows[0];
    if (!event || event.event_type !== "payment.failed") throw new Error("Verified failure event required");
    assertEventEnvironment(event.mode);
    const account = (await lockAccounts(client, [event.account_id]))[0];
    if (!account.user_id) throw new Error("Account unavailable");
    const key = `failure:${eventId}`;
    if (await duplicate(client, key, account.id)) return;
    const payment = (await client.query("SELECT * FROM billing_transactions WHERE id=$1 FOR UPDATE", [event.transaction_id])).rows[0];
    if (!payment || payment.status !== "failed" || Number(payment.captured_minor) !== 0 || payment.account_id !== account.id || payment.provider !== event.provider || payment.mode !== event.mode) throw new Error("Failure evidence mismatch");
    const sub = await subscription(client, account.user_id);
    if (sub.access_source !== "subscription_v1" || sub.provider_subscription_id) throw new Error("Use existing provider reconciliation");
    if (sub.current_period_end && Date.parse(sub.current_period_end) > (await now(client)).getTime()) throw new Error("Do not revoke an unexpired paid/trial period");
    if ((await client.query("SELECT 1 FROM billing_transactions WHERE account_id=$1 AND captured_minor>0 AND paid_at >= $2", [account.id, payment.created_at])).rowCount) throw new Error("Stale payment failure");
    await client.query("UPDATE subscriptions SET status='past_due' WHERE user_id=$1", [account.user_id]);
    await audit(client, account.id, key, "failed", { eventId });
  });
}

export async function expireSubscription(accountId: string) {
  return billingTransaction(async client => {
    const account = (await lockAccounts(client, [accountId]))[0];
    if (!account.user_id) return;
    const sub = await subscription(client, account.user_id);
    if (sub.access_source !== "subscription_v1" || sub.provider_subscription_id) return;
    const end = sub.status === "trialing" ? sub.trial_end : sub.current_period_end ?? sub.expires_at;
    if (!end || Date.parse(end) > (await now(client)).getTime() || !["active","trialing","canceled"].includes(sub.status)) return;
    await client.query("UPDATE subscriptions SET status='expired' WHERE user_id=$1", [account.user_id]);
    await audit(client, accountId, `expire:${accountId}:${end}`, "expire", { before: end, after: end });
  });
}
