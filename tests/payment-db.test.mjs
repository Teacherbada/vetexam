import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID, createHmac } from "node:crypto";
import { test } from "node:test";
import ts from "typescript";
import nextEnv from "@next/env";
import pg from "pg";

function load(path, mocks) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function("require", "exports", code)(name => {
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected import ${name}`);
  }, exports);
  return exports;
}

test("PostgreSQL checkout/event lifecycle, durable trial history, refunds and transactional retries", { skip: process.env.PAYMENT_DB_TEST !== "1" }, async () => {
  nextEnv.loadEnvConfig(process.cwd());
  const previous = process.env.BILLING_IDENTITY_SECRET;
  process.env.BILLING_IDENTITY_SECRET = "fixture-only-secret-never-used-for-real-accounts";
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  await client.connect();
  const schema = "payment_test_" + randomUUID().replaceAll("-", "");
  try {
    await client.query("BEGIN");
    // Schema name is generated above, never external input. Everything rolls back.
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema},public`);
    await client.query('CREATE TABLE "user" (id text PRIMARY KEY)');
    await client.query("CREATE TABLE subscriptions (LIKE public.subscriptions INCLUDING ALL)");
    await client.query("CREATE SEQUENCE fixture_subscription_id");
    await client.query("ALTER TABLE subscriptions ALTER COLUMN id SET DEFAULT nextval('fixture_subscription_id')");
    const migration = readFileSync(new URL("../migrations/20260906_payment_foundation.sql", import.meta.url), "utf8");
    await client.query(migration);
    await client.query(migration); // Rerun is additive and preserves constraints.
    await client.query('INSERT INTO "user"(id) VALUES($1)', ["member"]);
    let seq = 0;
    const transaction = async run => {
      const savepoint = `operation_${++seq}`;
      await client.query(`SAVEPOINT ${savepoint}`);
      try { const value = await run(client); await client.query(`RELEASE SAVEPOINT ${savepoint}`); return value; }
      catch (error) { await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`); throw error; }
    };
    const policy = load("lib/payment/policy.ts", {});
    const subPolicy = load("lib/subscription-state.ts", {});
    const events = load("lib/payment/events.ts", { "./policy": policy });
    const terms = { plan: "pro_monthly", amountMinor: 19900, currency: "TWD", trialDays: 30 };
    const checkouts = new Map(), snapshots = new Map(), payments = new Map();
    let creates = 0, cancels = 0, resumes = 0, validSignature = true, failInvoice = false;
    let nextEvent;
    const provider = {
      name: "fixture", mode: "test", supportsResume: true, hostedOrigins: ["https://pay.example.test"],
      validatePrice: async (price, actualTerms) => { assert.equal(price, "price"); assert.equal(actualTerms.amountMinor, 19900); },
      ensureCustomer: async () => "customer",
      createCheckout: async attempt => {
        creates++;
        const checkout = { id: attempt.id, customerId: "customer", subscriptionId: null, url: "https://pay.example.test/checkout", status: "open", expiresAt: new Date(Date.now()+3600000).toISOString(), trialDays: attempt.terms.trialDays };
        checkouts.set(checkout.id, checkout); return checkout;
      },
      getCheckout: async id => checkouts.get(id),
      getSubscription: async id => snapshots.get(id),
      getPayment: async id => { if (failInvoice) throw new Error("provider timeout"); return payments.get(id); },
      cancelSubscription: async id => { cancels++; snapshots.get(id).cancelAtPeriodEnd = true; },
      resumeSubscription: async id => { resumes++; snapshots.get(id).cancelAtPeriodEnd = false; },
      createPortal: async () => "https://pay.example.test/portal",
      verifyWebhook: async () => { if (!validSignature) throw new Error("bad signature"); return nextEvent; },
    };
    const service = load("lib/payment/service.ts", {
      "server-only": {}, "node:crypto": { randomUUID, createHmac }, "./db": { billingTransaction: transaction },
      "./config": { getPaymentConfiguration: () => ({ origin: "https://example.test", priceReference: "price", terms }) },
      "./provider": { getPaymentProvider: () => provider }, "./policy": policy, "./events": events,
      "@/lib/subscription-state": subPolicy,
    });
    const user = { id: "member", email: "member@example.test" };
    await service.createCheckout(user);
    await service.createCheckout(user);
    assert.equal(creates, 1, "repeated Checkout reuses a durable intent");
    const checkout = [...checkouts.values()][0];
    assert.equal(checkout.trialDays, 30);
    checkout.status = "completed"; checkout.subscriptionId = "sub";
    const start = new Date(Date.now()-86400000).toISOString(), end = new Date(Date.now()+29*86400000).toISOString();
    snapshots.set("sub", { id: "sub", customerId: "customer", userId: "member", priceReference: "price", status: "trialing",
      trialStart: start, trialEnd: end, periodStart: start, periodEnd: end, canceledAt: null, cancelAtPeriodEnd: false, paymentMethodBound: true });
    nextEvent = { id: "trial", type: "subscription.created", provider: "fixture", mode: "test", customerId: "customer", subscriptionId: "sub", invoiceId: null };
    validSignature = false;
    await assert.rejects(service.processWebhook(new Uint8Array(), new Headers()));
    assert.equal((await client.query("SELECT count(*)::int AS n FROM payment_events")).rows[0].n, 0);
    validSignature = true;
    await service.processWebhook(new Uint8Array(), new Headers());
    assert.equal((await service.processWebhook(new Uint8Array(), new Headers())).duplicate, true);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM payment_events")).rows[0].n, 1);
    const sub = (await client.query("SELECT * FROM subscriptions")).rows[0];
    assert.equal(subPolicy.evaluateSubscription(sub).hasProAccess, true);
    await assert.rejects(service.createCheckout(user), /已有訂閱/);
    await service.manageBilling(user, "cancel");
    await service.manageBilling(user, "cancel");
    assert.equal(cancels, 1);
    assert.equal(subPolicy.evaluateSubscription((await client.query("SELECT * FROM subscriptions")).rows[0]).hasProAccess, true);
    await service.manageBilling(user, "resume");
    await service.manageBilling(user, "resume");
    assert.equal(resumes, 1);
    snapshots.get("sub").status = "active";
    payments.set("invoice", { invoiceId: "invoice", paymentId: "payment", subscriptionId: "sub", currency: "TWD", amountMinor: 19900, capturedMinor: 19900,
      refundedMinor: 0, status: "paid", paidAt: start });
    nextEvent = { ...nextEvent, id: "paid", type: "invoice.paid", invoiceId: "invoice" };
    failInvoice = true;
    await assert.rejects(service.processWebhook(new Uint8Array(), new Headers()));
    assert.equal((await client.query("SELECT status FROM subscriptions")).rows[0].status, "trialing", "partial snapshot rolls back with event failure");
    assert.equal((await client.query("SELECT count(*)::int AS n FROM payment_events")).rows[0].n, 1);
    failInvoice = false;
    await service.processWebhook(new Uint8Array(), new Headers());
    assert.equal((await client.query("SELECT first_paid_at FROM billing_accounts")).rows[0].first_paid_at.toISOString(), start);
    nextEvent = { ...nextEvent, id: "refund", type: "payment.refunded" };
    payments.get("invoice").status = "refunded"; payments.get("invoice").refundedMinor = 19900;
    await service.processWebhook(new Uint8Array(), new Headers());
    assert.equal((await client.query("SELECT status FROM billing_transactions")).rows[0].status, "refunded");
    assert.equal((await client.query("SELECT first_paid_at FROM billing_accounts")).rows[0].first_paid_at.toISOString(), start);
    snapshots.get("sub").status = "expired";
    snapshots.get("sub").periodEnd = new Date(Date.now()-1000).toISOString();
    await service.manageBilling(user, "sync");
    await service.createCheckout(user);
    assert.equal([...checkouts.values()][1].trialDays, 0, "expiration does not reset permanent trial history");
    assert.equal((await client.query("SELECT count(*)::int AS n FROM billing_customers")).rows[0].n, 1);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
    if (previous === undefined) delete process.env.BILLING_IDENTITY_SECRET; else process.env.BILLING_IDENTITY_SECRET = previous;
  }
});
