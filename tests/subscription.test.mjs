import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { createElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

function load(path, mocks = {}) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  new Function("require", "exports", code)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    throw new Error(`Unexpected import: ${name}`);
  }, exports);
  return exports;
}
const policy = load("lib/subscription-state.ts");
const now = new Date("2026-09-06T12:00:00Z");
const before = "2026-09-01T12:00:00Z";
const after = "2026-10-01T12:00:00Z";
const record = {
  id: 1, user_id: "member", plan: "pro", status: "active", expires_at: null,
  trial_start: null, trial_end: null, current_period_start: before, current_period_end: after,
  cancel_at_period_end: false, canceled_at: null, access_source: null,
  provider: null, provider_customer_id: null, provider_subscription_id: null,
  created_at: before, updated_at: before, checked_at: now.toISOString(),
};
const evaluate = overrides => policy.evaluateSubscription({ ...record, ...overrides }, now);

test("free and missing records have no Pro access", () => {
  assert.equal(policy.evaluateSubscription(null, now).hasProAccess, false);
  assert.equal(evaluate({ plan: "free" }).hasProAccess, false);
  assert.equal(evaluate({ plan: "free" }).status, "free");
  assert.equal(evaluate({ status: "free" }).hasProAccess, false);
});
test("trial grants access only inside its own start/end window", () => {
  assert.equal(evaluate({ status: "trialing", trial_start: before, trial_end: after }).hasProAccess, true);
  for (const trial_end of [before, now.toISOString(), null, "invalid"]) {
    assert.equal(evaluate({ status: "trialing", trial_start: before, trial_end }).hasProAccess, false);
  }
  assert.equal(evaluate({ status: "trialing", trial_start: after, trial_end: "2026-11-01" }).hasProAccess, false);
  assert.equal(evaluate({ status: "trialing", trial_end: after }).hasProAccess, false);
  assert.equal(evaluate({ status: "trialing", trial_start: before, trial_end: before }).status, "expired");
  assert.equal(evaluate({ status: "trialing", trial_start: before, trial_end: "2026-09-07T00:00:00Z" }).trialDaysRemaining, 1);
});
test("active and canceled retain access only until the exclusive end boundary", () => {
  for (const status of ["active", "canceled", "cancelled"]) {
    assert.equal(evaluate({ status }).hasProAccess, true);
    for (const current_period_end of [before, now.toISOString(), null, "invalid"]) {
      assert.equal(evaluate({ status, current_period_end }).hasProAccess, false);
    }
    assert.equal(evaluate({ status, current_period_end: now.toISOString() }).status, "expired");
  }
  assert.equal(evaluate({ current_period_start: after }).hasProAccess, false);
  assert.equal(evaluate({ current_period_start: "invalid" }).hasProAccess, false);
  assert.equal(evaluate({ current_period_start: now.toISOString() }).hasProAccess, true);
});
test("past due and expired never grant access, even with future periods", () => {
  for (const status of ["past_due", "expired", "unknown"]) assert.equal(evaluate({ status }).hasProAccess, false);
});
test("legacy expiry is a fallback; current period is authoritative", () => {
  assert.equal(evaluate({ current_period_end: null, expires_at: after }).hasProAccess, true);
  assert.equal(evaluate({ current_period_end: before, expires_at: after }).hasProAccess, false);
});
test("only explicitly migrated manual grants retain unbounded access", () => {
  const legacy = { current_period_end: null, access_source: "legacy_manual" };
  assert.equal(evaluate(legacy).hasProAccess, true);
  for (const override of [{ status: "canceled" }, { status: "expired" }, { cancel_at_period_end: true }, { provider: "test" }, { access_source: null }]) {
    assert.equal(evaluate({ ...legacy, ...override }).hasProAccess, false);
  }
});
test("renewal date requires recurring provider data and no cancellation", () => {
  assert.equal(evaluate({}).nextRenewalAt, null);
  const recurring = { provider: "test", provider_subscription_id: "sub_test" };
  assert.equal(evaluate(recurring).nextRenewalAt, after);
  for (const override of [{ cancel_at_period_end: true }, { status: "canceled" }, { status: "past_due" }]) {
    assert.equal(evaluate({ ...recurring, ...override }).nextRenewalAt, null);
  }
});

const nextServer = { NextResponse: { json: (body, init) => Response.json(body, init) } };
test("API uses the Better Auth session, ignores forged identity, and redacts provider IDs", async () => {
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "test";
  let session = null;
  let queries = 0;
  let fail = false;
  let found = true;
  const service = load("lib/subscription.ts", {
    "server-only": {}, "@/lib/subscription-state": policy,
    "@/lib/auth": { auth: { api: { getSession: async () => session } } },
    "@neondatabase/serverless": { neon: () => async (_strings, ...values) => {
      queries++;
      assert.deepEqual(values, ["member"]);
      if (fail) throw new Error("secret-database-url");
      return found ? [{ ...record, provider_customer_id: "private-customer" }] : [];
    } },
  });
  const api = load("app/api/subscription/route.ts", { "next/server": nextServer, "@/lib/subscription": service });
  const request = new Request("https://example.test/api/subscription?userId=victim&isPro=true&role=admin&status=active", {
    headers: { "x-user-id": "victim", "x-is-admin": "true" },
  });
  try {
    const anonymous = await api.GET(request);
    assert.equal(anonymous.status, 401);
    assert.equal((await anonymous.json()).subscription, null);
    assert.equal(await service.hasProAccess(request.headers), false);
    assert.equal(queries, 0);
    session = { user: { id: "member", email: "member@example.test", name: "Member", isPro: false } };
    const response = await api.GET(request);
    const body = await response.json();
    assert.equal(body.user.id, "member");
    assert.equal(body.access.hasProAccess, true);
    assert.equal(body.subscription.provider_customer_id, undefined);
    assert.equal(body.subscription.access_source, undefined);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("vary"), "Cookie");
    found = false;
    assert.equal((await (await api.GET(request)).json()).access.hasProAccess, false);
    fail = true;
    const failure = await api.GET(request);
    assert.equal(failure.status, 503);
    assert.doesNotMatch(await failure.text(), /secret-database-url/);
    assert.equal(failure.headers.get("cache-control"), "private, no-store");
    assert.equal(api.POST, undefined);
    assert.equal(api.PATCH, undefined);
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  }
});
test("admin identity remains separate from subscriber entitlement", async () => {
  const previous = process.env.ADMIN_USER_ID;
  process.env.ADMIN_USER_ID = "admin";
  let session;
  const api = load("app/api/admin/status/route.ts", {
    "next/server": nextServer,
    "@/lib/auth": { auth: { api: { getSession: async () => session } } },
  });
  try {
    session = { user: { id: "admin", isPro: false } };
    assert.equal((await (await api.GET(new Request("https://example.test"))).json()).isAdmin, true);
    assert.equal(evaluate({ plan: "free" }).hasProAccess, false);
    session = { user: { id: "member", isPro: true, role: "admin" } };
    assert.equal((await (await api.GET(new Request("https://example.test?isAdmin=true"))).json()).isAdmin, false);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_USER_ID; else process.env.ADMIN_USER_ID = previous;
  }
});
test("manual import delegates entitlement to the server guard before reading request data", async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "test";
  let allowed = false;
  const route = load("app/api/manual-questions/route.ts", {
    "next/server": nextServer,
    "@/lib/auth": { auth: { api: { getSession: async () => ({ user: { id: "member" } }) } } },
    "@/lib/subscription": { hasProAccess: async () => allowed },
    "@neondatabase/serverless": { neon: () => () => { throw new Error("Unexpected write"); } },
  });
  const request = () => new Request("https://example.test", { method: "POST", body: JSON.stringify({ isPro: true, userId: "victim", questions: [] }) });
  try {
    assert.equal((await route.POST(request())).status, 403);
    allowed = true;
    // Authorized requests proceed to existing validation, not a database write.
    assert.equal((await route.POST(request())).status, 400);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
  }
});

test("subscription page renders anonymous, unavailable and all membership states truthfully", async () => {
  let result = null;
  let unavailable = false;
  const page = load("app/subscription/page.tsx", {
    "react/jsx-runtime": jsxRuntime,
    "next/link": { default: props => createElement("a", props) },
    "next/headers": { headers: async () => new Headers() },
    "@/components/dashboard/StudyUI": { StudyIcon: () => null },
    "@/app/analysis/analysis.module.css": { default: {} },
    "./subscription.module.css": { default: {} },
    "@/lib/payment/view": { getBillingView: async () => ({ enabled: false, managed: false, terms: { currency: "TWD", amountMinor: 19900, trialDays: 30 } }) },
    "./BillingActions": { default: () => createElement("button", { disabled: true }, "升級 Pro · 即將開放") },
    "./RefreshSubscription": { default: () => createElement("button", {}, "重新整理狀態") },
    "@/lib/subscription": { getUserSubscription: async () => {
      if (unavailable) throw new Error("offline");
      return result;
    } },
  });
  const render = async () => renderToStaticMarkup(await page.default());
  assert.match(await render(), /登入後查看你的方案/);
  unavailable = true;
  assert.match(await render(), /暫時無法讀取會員資料/);
  assert.doesNotMatch(await render(), /目前方案：免費版/);
  unavailable = false;
  for (const [overrides, expected] of [
    [{ plan: "free", status: "free" }, /目前方案：免費版/],
    [{ status: "trialing", trial_start: before, trial_end: after }, /Pro 免費試用中/],
    [{}, /目前方案：VetExam Pro/],
    [{ status: "past_due" }, /付款狀態待處理，Pro 權限暫停/],
    [{ status: "canceled" }, /仍可使用至/],
    [{ cancel_at_period_end: true }, /仍可使用至/],
    [{ status: "expired" }, /你的 Pro 期間已結束/],
    [{ status: "trialing", trial_start: before, trial_end: now.toISOString() }, /你的 Pro 期間已結束/],
  ]) {
    result = { user: { id: "member" }, subscription: { ...record, ...overrides }, access: evaluate(overrides) };
    const html = await render();
    assert.match(html, expected);
    assert.match(html, /href="\/" aria-label="回首頁"/);
    assert.match(html, /disabled=""[^>]*>升級 Pro · 即將開放/);
  }
});
