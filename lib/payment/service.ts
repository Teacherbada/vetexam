import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { billingTransaction } from "./db";
import { getPaymentConfiguration } from "./config";
import { getPaymentProvider } from "./provider";
import { assertHostedUrl, BillingError, validateSnapshot } from "./policy";
import { processPaymentEvent, type EventTransaction } from "./events";
import type { HostedCheckout, PaymentProvider, PaymentSnapshot, SubscriptionSnapshot, VerifiedPaymentEvent } from "./types";
import { evaluateSubscription, type SubscriptionRecord } from "@/lib/subscription-state";

type User = { id: string; email: string; emailVerified?: boolean };
type Account = { id: string; user_id: string; trial_started_at: Date | null };
type Attempt = {
  id: string; provider: string; mode: string; provider_checkout_id: string | null;
  amount_minor: number; trial_days: number; price_reference: string; return_url: string; cancel_url: string;
};

async function accountForUser(client: PoolClient, user: User): Promise<Account> {
  const existing = await client.query<Account>("SELECT * FROM billing_accounts WHERE user_id=$1 FOR UPDATE", [user.id]);
  if (existing.rows[0]) return existing.rows[0];
  const secret = process.env.BILLING_IDENTITY_SECRET;
  if (!secret || secret.length < 32) throw new Error("Stable BILLING_IDENTITY_SECRET required");
  const identity = createHmac("sha256", secret).update(user.email.trim().toLowerCase()).digest("hex");
  await client.query("INSERT INTO billing_accounts(id,user_id,identity_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [randomUUID(), user.id, identity]);
  const result = await client.query<Account>("SELECT * FROM billing_accounts WHERE user_id=$1 OR identity_hash=$2 FOR UPDATE", [user.id, identity]);
  const account = result.rows[0];
  if (!account || (account.user_id && account.user_id !== user.id)) throw new BillingError("BILLING_IDENTITY_CONFLICT", 409, "會員付款資料需要核對，請聯絡我們。");
  if (!account.user_id) {
    if (!user.emailVerified) throw new BillingError("EMAIL_VERIFICATION_REQUIRED", 409, "此電子郵件有既有付款紀錄，請先完成信箱驗證再聯絡我們恢復付款帳戶。");
    await client.query("UPDATE billing_accounts SET user_id=$1 WHERE id=$2", [user.id, account.id]);
    account.user_id = user.id;
  }
  return account;
}

async function saveSnapshot(client: PoolClient, account: Account, provider: PaymentProvider, snapshot: SubscriptionSnapshot) {
  await client.query(`UPDATE subscriptions SET plan='pro',status=$2,trial_start=$3,trial_end=$4,
    current_period_start=$5,current_period_end=$6,expires_at=$6,cancel_at_period_end=$7,canceled_at=$8,
    access_source='payment',provider=$9,provider_customer_id=$10,provider_subscription_id=$11 WHERE user_id=$1`,
  [account.user_id, snapshot.status, snapshot.trialStart, snapshot.trialEnd, snapshot.periodStart, snapshot.periodEnd,
    snapshot.cancelAtPeriodEnd, snapshot.canceledAt, provider.name, snapshot.customerId, snapshot.id]);
  if (snapshot.trialStart) await client.query("UPDATE billing_accounts SET trial_started_at=COALESCE(trial_started_at,$2) WHERE id=$1", [account.id, snapshot.trialStart]);
}

async function savePayment(client: PoolClient, accountId: string, provider: PaymentProvider, payment: PaymentSnapshot) {
  await client.query(`INSERT INTO billing_transactions(id,account_id,provider,mode,provider_invoice_id,provider_payment_id,
    provider_subscription_id,amount_minor,captured_minor,refunded_minor,currency,status,paid_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT(provider,mode,provider_invoice_id) DO UPDATE SET
      provider_payment_id=EXCLUDED.provider_payment_id,captured_minor=EXCLUDED.captured_minor,
      refunded_minor=EXCLUDED.refunded_minor,status=EXCLUDED.status,paid_at=EXCLUDED.paid_at,updated_at=NOW()
    WHERE billing_transactions.account_id=EXCLUDED.account_id`,
  [randomUUID(), accountId, provider.name, provider.mode, payment.invoiceId, payment.paymentId, payment.subscriptionId,
    payment.amountMinor, payment.capturedMinor, payment.refundedMinor, payment.currency, payment.status, payment.paidAt]);
  // MIN handles delayed initial-payment notifications. A later refund does not erase history.
  await client.query(`UPDATE billing_accounts SET first_paid_at=(SELECT MIN(paid_at) FROM billing_transactions
    WHERE account_id=$1 AND captured_minor>0 AND mode=$2),
    first_paid_transaction_id=(SELECT id FROM billing_transactions WHERE account_id=$1 AND captured_minor>0 AND mode=$2
      ORDER BY paid_at,provider_invoice_id LIMIT 1) WHERE id=$1`, [accountId, provider.mode]);
}

async function persistCheckout(client: PoolClient, attempt: Attempt, checkout: HostedCheckout, provider: PaymentProvider, customerId: string) {
  if (checkout.customerId !== customerId || !checkout.id || !Number.isFinite(Date.parse(checkout.expiresAt))) throw new Error("Invalid hosted checkout");
  if (!["open", "completed", "expired"].includes(checkout.status)) throw new Error("Invalid checkout status");
  const url = checkout.status === "open" && checkout.url ? assertHostedUrl(checkout.url, provider) : null;
  await client.query("UPDATE billing_checkouts SET provider_checkout_id=$2,state=$3,checkout_url=$4,expires_at=$5,provider_subscription_id=$6 WHERE id=$1",
    [attempt.id, checkout.id, checkout.status, url, checkout.expiresAt, checkout.subscriptionId]);
  return url;
}

export async function createCheckout(user: User) {
  const provider = getPaymentProvider(), config = getPaymentConfiguration();
  // Commit the intent before any external create. Retries always reuse the same intent ID.
  const prepared = await billingTransaction(async client => {
    const account = await accountForUser(client, user);
    await client.query("INSERT INTO subscriptions(user_id,plan,status) VALUES($1,'free','free') ON CONFLICT(user_id) DO NOTHING", [user.id]);
    const sub = (await client.query<SubscriptionRecord>("SELECT * FROM subscriptions WHERE user_id=$1", [user.id])).rows[0];
    const unconfirmed = await client.query("SELECT 1 FROM billing_checkouts WHERE account_id=$1 AND state='completed'", [account.id]);
    if (unconfirmed.rowCount) throw new BillingError("AWAITING_WEBHOOK", 409, "付款資訊正在確認中，請稍後重新整理會員狀態。");
    if (evaluateSubscription(sub).hasProAccess || (sub.provider_subscription_id && !["expired", "canceled"].includes(sub.status))) {
      throw new BillingError("SUBSCRIPTION_EXISTS", 409, "已有訂閱，請使用訂閱管理或更新付款方式。");
    }
    if (sub.trial_start) await client.query("UPDATE billing_accounts SET trial_started_at=COALESCE(trial_started_at,$2) WHERE id=$1", [account.id, sub.trial_start]);
    let attempt = (await client.query<Attempt>("SELECT * FROM billing_checkouts WHERE account_id=$1 AND state IN ('pending','open')", [account.id])).rows[0];
    if (!attempt) {
      const id = randomUUID();
      attempt = (await client.query<Attempt>(`INSERT INTO billing_checkouts(id,account_id,provider,mode,price_reference,amount_minor,currency,trial_days,return_url,cancel_url)
        VALUES($1,$2,$3,$4,$5,$6,'TWD',$7,$8,$9) RETURNING *`, [id, account.id, provider.name, provider.mode,
        config.priceReference, config.terms.amountMinor, account.trial_started_at || sub.trial_start ? 0 : config.terms.trialDays,
        config.origin + "/subscription/return", config.origin + "/subscription"])).rows[0];
    }
    if (attempt.provider !== provider.name || attempt.mode !== provider.mode) throw new Error("Unresolved checkout from different environment");
    return { accountId: account.id, attemptId: attempt.id };
  });
  const outcome = await billingTransaction(async client => {
    await client.query("SELECT id FROM billing_accounts WHERE id=$1 FOR UPDATE", [prepared.accountId]);
    const attempt = (await client.query<Attempt>("SELECT * FROM billing_checkouts WHERE id=$1", [prepared.attemptId])).rows[0];
    const current = (await client.query<SubscriptionRecord>("SELECT * FROM subscriptions WHERE user_id=$1", [user.id])).rows[0];
    if (current?.provider_subscription_id) {
      if (current.provider !== provider.name) throw new BillingError("OTHER_PROVIDER_SUBSCRIPTION", 409, "請先確認原付款平台的訂閱狀態。");
      const actual = await provider.getSubscription(current.provider_subscription_id);
      if (actual.customerId !== current.provider_customer_id || actual.userId !== user.id) throw new Error("Provider subscription ownership mismatch");
      if (["active", "trialing", "past_due"].includes(actual.status) || (actual.status === "canceled" && Date.parse(actual.periodEnd) > Date.now())) {
        throw new BillingError("SUBSCRIPTION_EXISTS", 409, "付款平台仍有有效訂閱，請先同步付款狀態。");
      }
    }
    const terms = { ...config.terms, amountMinor: attempt.amount_minor, trialDays: attempt.trial_days };
    await provider.validatePrice(attempt.price_reference, terms);
    let customerId = (await client.query<{ provider_customer_id: string }>("SELECT provider_customer_id FROM billing_customers WHERE account_id=$1 AND provider=$2 AND mode=$3", [prepared.accountId, provider.name, provider.mode])).rows[0]?.provider_customer_id;
    if (!customerId) {
      customerId = await provider.ensureCustomer({ accountId: prepared.accountId, userId: user.id, email: user.email });
      await client.query("INSERT INTO billing_customers(id,account_id,provider,mode,provider_customer_id) VALUES($1,$2,$3,$4,$5)", [randomUUID(), prepared.accountId, provider.name, provider.mode, customerId]);
    }
    const checkout = attempt.provider_checkout_id ? await provider.getCheckout(attempt.provider_checkout_id) : await provider.createCheckout({
      id: attempt.id, accountId: prepared.accountId, userId: user.id, customerId, priceReference: attempt.price_reference,
      terms, returnUrl: attempt.return_url, cancelUrl: attempt.cancel_url,
    });
    return { url: await persistCheckout(client, attempt, checkout, provider, customerId), status: checkout.status };
  });
  if (!outcome.url) throw new BillingError("CHECKOUT_NOT_OPEN", 409, outcome.status === "completed" ? "付款資訊已收到，請重新整理會員狀態。" : "上次付款流程已結束，請重新開始。");
  return { url: outcome.url };
}

export async function processWebhook(rawBody: Uint8Array, headers: Headers) {
  const provider = getPaymentProvider();
  let event: VerifiedPaymentEvent | null;
  try { event = await provider.verifyWebhook(rawBody, headers); }
  catch { throw new BillingError("INVALID_SIGNATURE", 400, "無效的付款通知。"); }
  if (!event) return { ignored: true };
  return billingTransaction(async client => {
    const account = (await client.query<Account & { provider_customer_id: string }>(`SELECT a.*,c.provider_customer_id FROM billing_accounts a
      JOIN billing_customers c ON c.account_id=a.id WHERE c.provider=$1 AND c.mode=$2 AND c.provider_customer_id=$3 FOR UPDATE OF a`,
    [provider.name, provider.mode, event.customerId])).rows[0];
    if (!account?.user_id) throw new Error("Webhook customer not yet mapped");
    const sub = (await client.query<SubscriptionRecord>("SELECT * FROM subscriptions WHERE user_id=$1", [account.user_id])).rows[0];
    const attempt = (await client.query<{ id: string; price_reference: string; provider_checkout_id: string | null; provider_subscription_id: string | null }>("SELECT * FROM billing_checkouts WHERE account_id=$1 AND provider=$2 AND mode=$3 ORDER BY CASE WHEN provider_subscription_id=$4 THEN 0 ELSE 1 END, created_at DESC LIMIT 1", [account.id, provider.name, provider.mode, event.subscriptionId])).rows[0];
    if (!sub || !attempt) throw new Error("Missing checkout provenance");
    let boundSubscriptionId = sub.provider_subscription_id;
    if (event.subscriptionId !== boundSubscriptionId) {
      if (!attempt.provider_checkout_id) throw new Error("Checkout mapping not yet persisted; retry webhook");
      const checkout = await provider.getCheckout(attempt.provider_checkout_id);
      if (checkout.status === "completed" && checkout.customerId === account.provider_customer_id && checkout.subscriptionId === event.subscriptionId) {
        boundSubscriptionId = event.subscriptionId;
      } else if (!boundSubscriptionId) throw new Error("Subscription is not bound to an authorized checkout");
    }
    const tx: EventTransaction = {
      account: { id: account.id, userId: account.user_id, customerId: account.provider_customer_id,
        subscriptionId: boundSubscriptionId, priceReference: attempt.price_reference },
      hasEvent: async e => (await client.query("SELECT 1 FROM payment_events WHERE provider=$1 AND mode=$2 AND provider_event_id=$3", [e.provider, e.mode, e.id])).rowCount !== 0,
      applySubscription: s => saveSnapshot(client, account, provider, s),
      savePayment: p => savePayment(client, account.id, provider, p),
      markProcessed: async e => { await client.query(`INSERT INTO payment_events(id,provider,mode,provider_event_id,event_type,account_id)
        VALUES($1,$2,$3,$4,$5,$6)`, [randomUUID(), e.provider, e.mode, e.id, e.type, account.id]); },
    };
    const result = await processPaymentEvent(provider, event, tx);
    if (boundSubscriptionId === event.subscriptionId && attempt.provider_checkout_id) {
      const checkout = await provider.getCheckout(attempt.provider_checkout_id);
      if (checkout.subscriptionId === event.subscriptionId && checkout.customerId === account.provider_customer_id) {
        await client.query("UPDATE billing_checkouts SET state='synchronized',provider_subscription_id=$2 WHERE id=$1 AND state <> 'expired'", [attempt.id, event.subscriptionId]);
      }
    }
    console.info("Payment event processed", { provider: provider.name, duplicate: result.duplicate });
    return result;
  });
}

export async function manageBilling(user: User, action: "cancel" | "resume" | "portal" | "sync") {
  const provider = getPaymentProvider(), config = getPaymentConfiguration();
  return billingTransaction(async client => {
    const account = await accountForUser(client, user);
    const sub = (await client.query<SubscriptionRecord>("SELECT * FROM subscriptions WHERE user_id=$1", [user.id])).rows[0];
    const customer = (await client.query<{ provider_customer_id: string }>("SELECT provider_customer_id FROM billing_customers WHERE account_id=$1 AND provider=$2 AND mode=$3", [account.id, provider.name, provider.mode])).rows[0];
    if (!customer) throw new BillingError("NO_BILLING_ACCOUNT", 409, "目前沒有可管理的付款資料。");
    if (action === "portal") return { url: assertHostedUrl(await provider.createPortal(customer.provider_customer_id, config.origin + "/subscription"), provider) };
    if (!sub?.provider_subscription_id || sub.provider !== provider.name || sub.provider_customer_id !== customer.provider_customer_id) throw new BillingError("NO_SUBSCRIPTION", 409, "目前沒有可管理的付款訂閱。");
    const snapshot = await provider.getSubscription(sub.provider_subscription_id);
    const expected = { userId: user.id, customerId: customer.provider_customer_id, subscriptionId: sub.provider_subscription_id, priceReference: snapshot.priceReference };
    validateSnapshot(snapshot, expected);
    if (action !== "sync") {
      if (!["trialing", "active", "past_due"].includes(snapshot.status) || Date.parse(snapshot.periodEnd) <= Date.now()) throw new BillingError("PERIOD_ENDED", 409, "訂閱已結束，請重新訂閱。");
      if (action === "resume" && !provider.supportsResume) throw new BillingError("RESUME_UNSUPPORTED", 409, "目前付款平台不支援恢復訂閱。");
      // Read provider first: repeating an already successful command performs no mutation.
      if ((action === "cancel") !== snapshot.cancelAtPeriodEnd) {
        const key = randomUUID();
        if (action === "cancel") await provider.cancelSubscription(snapshot.id, key);
        else await provider.resumeSubscription(snapshot.id, key);
      }
    }
    const latest = action === "sync" ? snapshot : await provider.getSubscription(snapshot.id);
    validateSnapshot(latest, expected);
    await saveSnapshot(client, account, provider, latest);
    return { refreshed: true };
  });
}
