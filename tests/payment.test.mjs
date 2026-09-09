import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

function load(path, mocks = {}) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", code)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    throw new Error(`Unexpected import: ${name}`);
  }, exports);
  return exports;
}
const policy = load("lib/payment/policy.ts");
const config = load("lib/payment/config.ts", { "server-only": {}, "@/lib/subscription/plans": load("lib/subscription/plans.ts") });
const events = load("lib/payment/events.ts", { "./policy": policy });
const snapshot = {
  id: "sub", customerId: "customer", userId: "member", priceReference: "price",
  status: "active", periodStart: "2026-09-01T00:00:00Z", periodEnd: "2026-10-01T00:00:00Z",
  trialStart: null, trialEnd: null, cancelAtPeriodEnd: false, canceledAt: null, paymentMethodBound: true,
};
const payment = { invoiceId: "invoice", paymentId: "payment", subscriptionId: "sub", currency: "TWD", amountMinor: 19900,
  capturedMinor: 19900, refundedMinor: 0, status: "paid", paidAt: "2026-09-01T00:00:00Z" };
const event = { id: "event", type: "invoice.paid", provider: "test-adapter", mode: "test", customerId: "customer", subscriptionId: "sub", invoiceId: "invoice" };

test("billing config never grants a checkout trial and rejects unsafe environments", () => {
  const saved = { ...process.env };
  try {
    for (const key of ["PRO_TRIAL_DAYS", "PRO_MONTHLY_AMOUNT_MINOR", "PAYMENT_MODE", "PAYMENT_ENABLED", "PAYMENT_LIVE_CONFIRMED", "VERCEL_ENV"]) delete process.env[key];
    assert.equal(config.getBillingTerms().trialDays, 0);
    assert.equal(config.getBillingTerms().amountMinor, 19900);
    assert.equal(config.getPaymentConfiguration().enabled, false);
    process.env.PRO_TRIAL_DAYS = "-1";
    assert.equal(config.getBillingTerms().trialDays, 0);
    delete process.env.PRO_TRIAL_DAYS;
    process.env.PAYMENT_MODE = "live";
    assert.throws(config.getPaymentConfiguration);
    process.env.PAYMENT_MODE = "test";
    process.env.PAYMENT_ENABLED = "true";
    process.env.VERCEL_ENV = "production";
    assert.throws(config.getPaymentConfiguration);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
test("no provider is registered and no environment flag can enable a mock checkout", () => {
  const registry = load("lib/payment/provider.ts", { "server-only": {}, "./policy": policy,
    "./config": { getPaymentConfiguration: () => ({ enabled: true, provider: "test-adapter", mode: "test" }) } });
  assert.equal(registry.paymentAvailable(), false);
  assert.throws(registry.getPaymentProvider, /尚未開放/);
});
test("redirects require the exact HTTPS provider origin", () => {
  const provider = { hostedOrigins: ["https://pay.example.test"] };
  assert.equal(policy.assertHostedUrl("https://pay.example.test/checkout", provider), "https://pay.example.test/checkout");
  for (const url of ["javascript:alert(1)", "https://pay.example.test.evil.test", "http://pay.example.test", "https://user:pass@pay.example.test"]) assert.throws(() => policy.assertHostedUrl(url, provider));
});
test("legacy provider trial snapshots retain binding validation; registration trials bypass providers", () => {
  const expected = { customerId: "customer", userId: "member", subscriptionId: "sub", priceReference: "price" };
  policy.validateSnapshot(snapshot, expected);
  for (const change of [{ customerId: "other" }, { userId: "other" }, { priceReference: "cheap" }, { periodEnd: snapshot.periodStart }, { status: "unknown" }]) assert.throws(() => policy.validateSnapshot({ ...snapshot, ...change }, expected));
  const trial = { ...snapshot, status: "trialing", trialStart: snapshot.periodStart, trialEnd: snapshot.periodEnd };
  policy.validateSnapshot(trial, expected);
  assert.throws(() => policy.validateSnapshot({ ...trial, paymentMethodBound: false }, expected));
});
test("actual money is distinguished from zero invoices, credits and refunds", () => {
  policy.validatePayment(payment, "sub");
  policy.validatePayment({ ...payment, capturedMinor: 0, paymentId: null, amountMinor: 0, paidAt: null }, "sub");
  policy.validatePayment({ ...payment, refundedMinor: 1000, status: "partially_refunded" }, "sub");
  policy.validatePayment({ ...payment, refundedMinor: 19900, status: "refunded" }, "sub");
  for (const change of [{ capturedMinor: -1 }, { capturedMinor: 20000 }, { paymentId: null }, { refundedMinor: 1000 }, { currency: "bad" }, { paidAt: "invalid" }]) assert.throws(() => policy.validatePayment({ ...payment, ...change }, "sub"));
});
test("duplicate events do not reapply state and delayed events re-fetch current provider facts", async () => {
  const seen = new Set();
  let applied = 0, paid = 0, reads = 0;
  const provider = { name: event.provider, mode: "test", getSubscription: async () => { reads++; return { ...snapshot, status: "past_due" }; }, getPayment: async () => payment };
  const tx = { account: { id: "a", userId: "member", customerId: "customer", subscriptionId: "sub", priceReference: "price" },
    hasEvent: async e => seen.has(e.id), applySubscription: async s => { applied++; assert.equal(s.status, "past_due"); },
    savePayment: async () => { paid++; }, markProcessed: async e => { seen.add(e.id); } };
  assert.equal((await events.processPaymentEvent(provider, event, tx)).duplicate, false);
  assert.equal((await events.processPaymentEvent(provider, event, tx)).duplicate, true);
  assert.deepEqual([applied, paid, reads], [1, 1, 1]);
  await assert.rejects(events.processPaymentEvent(provider, { ...event, mode: "live" }, tx));
});
test("processing errors do not mark an event as successfully processed", async () => {
  let marked = false;
  const provider = { name: event.provider, mode: "test", getSubscription: async () => snapshot, getPayment: async () => { throw new Error("timeout"); } };
  const tx = { account: { id: "a", userId: "member", customerId: "customer", subscriptionId: "sub", priceReference: "price" },
    hasEvent: async () => false, applySubscription: async () => {}, savePayment: async () => {}, markProcessed: async () => { marked = true; } };
  await assert.rejects(events.processPaymentEvent(provider, event, tx));
  assert.equal(marked, false);
});
test("old subscription refunds preserve the newer current subscription", async () => {
  let stateChanges = 0, payments = 0;
  const provider = { name: event.provider, mode: "test", getSubscription: async () => snapshot, getPayment: async () => ({ ...payment, status: "refunded", refundedMinor: 19900 }) };
  const tx = { account: { id: "a", userId: "member", customerId: "customer", subscriptionId: "new-sub", priceReference: "new-price" },
    hasEvent: async () => false, applySubscription: async () => { stateChanges++; }, savePayment: async () => { payments++; }, markProcessed: async () => {} };
  await events.processPaymentEvent(provider, event, tx);
  assert.deepEqual([stateChanges, payments], [0, 1]);
});
test("HTTP guards reject anonymous/forged identity and keep an unconfigured provider closed", async () => {
  let session = null, writes = 0;
  const api = load("lib/payment/http.ts", {
    "server-only": {}, "@/lib/auth": { auth: { api: { getSession: async () => session } } },
    "./config": { getPaymentConfiguration: () => ({ origin: "https://example.test" }) },
    "./provider": { getPaymentProvider: () => { throw new policy.BillingError("PAYMENT_NOT_CONFIGURED", 503, "尚未開放"); } },
    "./policy": policy, "./db": { billingTransaction: async () => { writes++; } },
    "./service": { createCheckout: async () => { writes++; }, manageBilling: async () => { writes++; }, processWebhook: async () => { writes++; } },
  });
  const req = () => new Request("https://example.test/api/billing/checkout?userId=admin&price=1", { method: "POST", body: '{"trialEligible":true}', headers: { origin: "https://example.test" } });
  assert.equal((await api.billingAction(req(), "checkout")).status, 401);
  session = { user: { id: "member", email: "member@example.test" } };
  for (const action of ["checkout", "cancel", "resume", "portal", "sync"]) assert.equal((await api.billingAction(req(), action)).status, 503);
  assert.equal((await api.billingWebhook(req())).status, 503);
  assert.equal(writes, 0);
});
