import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import ts from "typescript";
import nextEnv from "@next/env";
import pg from "pg";

function load(path, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function("require", "exports", code)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    throw new Error(`Unexpected import ${name}`);
  }, exports);
  return exports;
}
const calendar = load("lib/subscription/calendar.ts");
const plans = load("lib/subscription/plans.ts");
const policy = load("lib/subscription-state.ts");

test("registration hook grants trial after Free fallback and catches grant failures", async () => {
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://fixture";
  const calls = [];
  let fail = false;
  const originalError = console.error, originalLog = console.log;
  console.error = () => calls.push("error"); console.log = () => {};
  try {
    const { auth } = load("lib/auth.ts", {
      "better-auth": { betterAuth: config => config }, "pg": { Pool: class {} },
      "@neondatabase/serverless": { neon: () => async () => calls.push("free") },
      "@/lib/subscription/service": { startTrialForNewUser: async id => {
        calls.push(id); if (fail) throw new Error("fixture grant failed");
      } },
    });
    await auth.databaseHooks.user.create.after({ id: "new-user" });
    assert.deepEqual(calls, ["free", "new-user"]);
    fail = true;
    await assert.doesNotReject(auth.databaseHooks.user.create.after({ id: "retry-user" }));
    assert.deepEqual(calls.slice(2), ["free", "retry-user", "error"]);
    assert.equal(auth.databaseHooks.session, undefined);
  } finally {
    console.error = originalError; console.log = originalLog;
    if (saved === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved;
  }
});

test("plan amounts and Taiwan calendar months distinguish trial days, leap years and month end", () => {
  assert.deepEqual(plans.PRO_PLANS.map(p => [p.key,p.price,p.months]), [["monthly",199,1],["half_year",1095,6],["yearly",2189,12]]);
  assert.equal(plans.TRIAL_DAYS, 30);
  for (const [start, months, end] of [
    ["2027-01-30T16:30:00Z",1,"2027-02-27T16:30:00Z"],
    ["2028-01-30T16:30:00Z",1,"2028-02-28T16:30:00Z"],
    ["2028-02-28T16:30:00Z",12,"2029-02-27T16:30:00Z"],
    ["2027-08-30T16:30:00Z",6,"2028-02-28T16:30:00Z"],
  ]) assert.equal(calendar.addCalendarMonths(new Date(start),months).toISOString(),new Date(end).toISOString());
  assert.throws(() => plans.subscriptionPlan("annual"));
  const anchor = new Date("2027-01-30T16:30:00Z");
  const february = calendar.addCalendarMonths(anchor, 1);
  assert.equal(calendar.nextCalendarPeriodEnd(february, 1, anchor).toISOString(), "2027-03-30T16:30:00.000Z");
  assert.equal(calendar.nextCalendarPeriodEnd(new Date("2027-03-05T00:00:00Z"), 1, anchor).toISOString(), "2027-04-05T00:00:00.000Z");
  assert.throws(() => calendar.nextCalendarPeriodEnd(february, 0, anchor));
});

test("earned time preserves billing dates and exact trial countdown, while expiring at its own boundary", () => {
  const now = new Date("2027-01-01T00:00:00Z");
  const base = { plan:"pro",status:"trialing",trial_start:"2026-12-20T00:00:00Z",trial_end:"2027-01-19T00:00:00Z",current_period_start:"2026-12-20T00:00:00Z",current_period_end:"2027-01-19T00:00:00Z",reward_start:"2027-01-19T00:00:00Z",reward_end:"2027-02-19T00:00:00Z",cancel_at_period_end:true };
  let access=policy.evaluateSubscription(base,now);
  assert.equal(access.hasProAccess,true); assert.equal(access.trialDaysRemaining,18); assert.equal(access.accessUntil,base.reward_end); assert.equal(access.nextRenewalAt,null);
  access=policy.evaluateSubscription({...base,status:"active",cancel_at_period_end:false,provider:"fixture",provider_subscription_id:"sub"},now);
  assert.equal(access.nextRenewalAt,base.current_period_end); assert.equal(access.accessUntil,base.reward_end);
  assert.equal(policy.evaluateSubscription(base,new Date(base.trial_end)).hasProAccess,true);
  assert.equal(policy.evaluateSubscription(base,new Date(base.reward_end)).hasProAccess,false);
  assert.equal(policy.evaluateSubscription({...base,plan:"free",status:"free",reward_start:"invalid"},now).hasProAccess,false);
});

test("PostgreSQL V1: permanent trial, concurrent payment/reward deduplication, cancel, failure, rollback and additive migration", { skip: process.env.SUBSCRIPTION_DB_TEST !== "1" }, async () => {
  nextEnv.loadEnvConfig(process.cwd());
  const pool = new pg.Pool({ connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:10000 });
  const adminClient = await pool.connect();
  const schema = "subscription_v1_test_" + randomUUID().replaceAll("-", "");
  assert.match(schema,/^subscription_v1_test_[a-f0-9]{32}$/);
  // Neon may use transaction pooling: session-level SET is not a reliable schema boundary.
  const admin = { query: async (sql, values) => {
    await adminClient.query("BEGIN");
    try {
      await adminClient.query(`SET LOCAL search_path TO ${schema}`);
      const result = await adminClient.query(sql,values);
      await adminClient.query("COMMIT"); return result;
    } catch(error) { await adminClient.query("ROLLBACK"); throw error; }
  } };
  const migration=readFileSync(new URL("../migrations/20260907_subscription_backend_v1.sql",import.meta.url),"utf8");
  const foundation=readFileSync(new URL("../migrations/20260906_payment_foundation.sql",import.meta.url),"utf8");
  let created=false;
  try {
    await adminClient.query("BEGIN");
    await adminClient.query(`CREATE SCHEMA ${schema}`);
    await adminClient.query(`SET LOCAL search_path TO ${schema}`);
    await adminClient.query('CREATE TABLE "user"(id text PRIMARY KEY)');
    await adminClient.query("CREATE TABLE subscriptions (LIKE public.subscriptions INCLUDING ALL)");
    await adminClient.query("CREATE SEQUENCE fixture_subscriptions_id");
    await adminClient.query("ALTER TABLE subscriptions ALTER COLUMN id SET DEFAULT nextval('fixture_subscriptions_id')");
    await adminClient.query(foundation); await adminClient.query(migration); await adminClient.query(migration); await adminClient.query("COMMIT"); created=true;
    const transaction=async run=>{
      const client=await pool.connect();
      try { await client.query("BEGIN"); await client.query(`SET LOCAL search_path TO ${schema}`); await client.query("SET LOCAL lock_timeout='8s'"); const result=await run(client); await client.query("COMMIT"); return result; }
      catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    };
    const service=load("lib/subscription/service.ts",{"server-only":{},"node:crypto":{randomUUID},"@/lib/payment/db":{billingTransaction:transaction},"@/lib/subscription-state":policy,"./calendar":calendar,"./plans":plans});
    async function member(name) {
      const id=randomUUID(); await admin.query('INSERT INTO "user"(id) VALUES($1)',[name]);
      await admin.query("INSERT INTO billing_accounts(id,user_id,identity_hash) VALUES($1,$2,$3)",[id,name,name]);return id;
    }
    async function event(account,type,transactionId=null) {
      const id=randomUUID();await admin.query("INSERT INTO payment_events(id,provider,mode,provider_event_id,event_type,account_id,transaction_id) VALUES($1::uuid,'fixture','test',$1::uuid::text,$2,$3,$4)",[id,type,account,transactionId]);return id;
    }
    async function payment(account,kind="initial",key="monthly",status="paid") {
      const id=randomUUID(),price=plans.subscriptionPlan(key).price*100;
      await admin.query(`INSERT INTO billing_transactions(id,account_id,provider,mode,provider_invoice_id,provider_payment_id,provider_subscription_id,amount_minor,captured_minor,currency,status,paid_at,plan_key,transaction_type)
        VALUES($1::uuid,$2,'fixture','test',$1::uuid::text,$1::uuid::text,'fixture-sub',$3,$4,'TWD',$5,now(),$6,$7)`,[id,account,price,status==="paid"?price:0,status,key,kind]);
      return {id,event:await event(account,status==="paid"?"payment.succeeded":"payment.failed",id)};
    }
    // Successful registration needs no billing identity, card, provider or payment event.
    await admin.query('INSERT INTO "user"(id) VALUES($1)', ["registered"]);
    const grants = await Promise.all([service.startTrialForNewUser("registered"), service.startTrialForNewUser("registered")]);
    assert.equal(grants.filter(result => !result.duplicate).length, 1);
    let registered = (await admin.query("SELECT row_to_json(s) AS s FROM subscriptions s WHERE user_id='registered'")).rows[0].s;
    assert.equal(registered.status, "trialing");
    assert.equal(registered.billing_plan, null);
    assert.equal(Date.parse(registered.trial_end)-Date.parse(registered.trial_start), 30*86400000);
    assert.equal(policy.evaluateSubscription(registered).hasProAccess, true);
    assert.equal(policy.evaluateSubscription(registered, new Date(registered.trial_end)).hasProAccess, false);
    assert.equal(policy.evaluateSubscription(registered, new Date(registered.trial_end)).plan, "free");
    for (const table of ["billing_accounts", "billing_transactions", "billing_checkouts", "payment_events", "subscription_referrals"]) {
      assert.equal((await admin.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0);
    }
    const registrationEnd = registered.trial_end;
    await admin.query("UPDATE subscriptions SET status='expired' WHERE user_id='registered'");
    await service.startTrialForNewUser("registered");
    registered = (await admin.query("SELECT row_to_json(s) AS s FROM subscriptions s WHERE user_id='registered'")).rows[0].s;
    assert.equal(registered.status, "expired"); assert.equal(registered.trial_end, registrationEnd);
    await admin.query("DELETE FROM subscriptions WHERE user_id='registered'");
    assert.equal((await service.startTrialForNewUser("registered")).duplicate, true);
    assert.equal((await admin.query("SELECT status FROM subscriptions WHERE user_id='registered'")).rows[0].status, "free");

    const expiryAccount = await member("expiry");
    await service.startTrial(expiryAccount);
    await admin.query("UPDATE subscriptions SET trial_start=now()-interval '31 days',trial_end=now(),current_period_start=now()-interval '31 days',current_period_end=now(),expires_at=now() WHERE user_id='expiry'");
    await service.expireSubscription(expiryAccount);
    assert.equal((await admin.query("SELECT status FROM subscriptions WHERE user_id='expiry'")).rows[0].status,"expired");
    for (const table of ["billing_transactions", "billing_checkouts", "payment_events"]) {
      assert.equal((await admin.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0);
    }
    assert.equal((await admin.query("SELECT first_paid_at,first_paid_transaction_id FROM billing_accounts WHERE id=$1", [expiryAccount])).rows[0].first_paid_at, null);
    assert.equal((await admin.query("SELECT first_paid_transaction_id FROM billing_accounts WHERE id=$1", [expiryAccount])).rows[0].first_paid_transaction_id, null);

    const a=await member("A"),b=await member("B"),c=await member("C");
    await assert.rejects(service.registerReferral(a,a),/Self referral/);
    const referral=await service.registerReferral(a,b);
    assert.equal((await service.registerReferral(a,b)).duplicate,true);
    await assert.rejects(service.registerReferral(c,b),/immutable/);
    assert.equal(await service.isEligibleForTrial(b),true);
    const starts = await Promise.all([service.startTrial(b), service.startTrial(b)]);
    assert.equal(starts.filter(result => !result.duplicate).length, 1);
    assert.equal((await service.startTrial(b)).duplicate,true);
    assert.equal(await service.isEligibleForTrial(b),false);
    let sub=(await admin.query("SELECT row_to_json(s) AS s FROM subscriptions s WHERE user_id='B'")).rows[0].s;
    assert.equal(Date.parse(sub.trial_end)-Date.parse(sub.trial_start),30*86400000);
    assert.equal((await admin.query("SELECT status FROM subscription_referrals WHERE id=$1",[referral.id])).rows[0].status,"pending");
    await service.cancelAtPeriodEnd(b,"cancel-trial");
    sub=(await admin.query("SELECT row_to_json(s) AS s FROM subscriptions s WHERE user_id='B'")).rows[0].s;
    assert.equal(policy.evaluateSubscription(sub).hasProAccess,true);
    await admin.query("DELETE FROM subscriptions WHERE user_id='B'");
    assert.equal(await service.isEligibleForTrial(b),false);
    assert.equal((await service.startTrial(b)).duplicate,true);
    // Simulate historical completed trial in fixture only, never a real provider or real account.
    await admin.query(`INSERT INTO subscriptions(user_id,plan,status,billing_plan,trial_start,trial_end,current_period_start,current_period_end,access_source)
      VALUES('B','pro','trialing','monthly',now()-interval '31 days',now()-interval '1 day',now()-interval '31 days',now()-interval '1 day','subscription_v1')`);
    const first=await payment(b);
    const duplicateEvent=await event(b,"payment.succeeded",first.id);
    await admin.query("CREATE FUNCTION reject_fixture_reward() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='rewarded' THEN RAISE EXCEPTION 'fixture reward failure'; END IF; RETURN NEW; END $$");
    await admin.query("CREATE TRIGGER reject_fixture_reward BEFORE UPDATE ON subscription_referrals FOR EACH ROW EXECUTE FUNCTION reject_fixture_reward()");
    await assert.rejects(service.activateSubscription(first.event),/fixture reward failure/);
    assert.equal((await admin.query("SELECT status FROM subscriptions WHERE user_id='B'")).rows[0].status,"trialing");
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM subscription_operations WHERE transaction_id=$1",[first.id])).rows[0].n,0);
    await admin.query("DROP TRIGGER reject_fixture_reward ON subscription_referrals");
    const outcomes=await Promise.all([service.activateSubscription(first.event),service.activateSubscription(first.event),service.activateSubscription(duplicateEvent)]);
    assert.equal(outcomes.filter(x=>!x.duplicate).length,1);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM subscription_operations WHERE transaction_id=$1",[first.id])).rows[0].n,1);
    let reward=(await admin.query("SELECT * FROM subscription_referrals WHERE id=$1",[referral.id])).rows[0];
    assert.equal(reward.status,"rewarded");
    assert.equal(reward.reward_end.toISOString(),calendar.addCalendarMonths(reward.reward_start,1).toISOString());
    const earned=(await admin.query("SELECT row_to_json(s) AS s FROM subscriptions s WHERE user_id='A'")).rows[0].s;
    assert.equal(policy.evaluateSubscription(earned).hasProAccess,true);
    const renewal=await payment(b,"renewal");
    const previousEnd=(await admin.query("SELECT current_period_end FROM subscriptions WHERE user_id='B'")).rows[0].current_period_end;
    await Promise.all([service.activateSubscription(renewal.event),service.activateSubscription(renewal.event)]);
    sub=(await admin.query("SELECT row_to_json(s) AS s FROM subscriptions s WHERE user_id='B'")).rows[0].s;
    assert.equal(Date.parse(sub.current_period_end),calendar.addCalendarMonths(previousEnd,1).getTime());
    assert.equal(policy.evaluateSubscription(sub).hasProAccess,true);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM subscription_operations WHERE referral_id=$1",[referral.id])).rows[0].n,1);
    const secondReferral=await service.registerReferral(a,c);
    await service.startTrial(c);
    await admin.query("UPDATE subscriptions SET trial_start=now()-interval '31 days',trial_end=now()-interval '1 day',current_period_start=now()-interval '31 days',current_period_end=now()-interval '1 day' WHERE user_id='C'");
    const second=await payment(c,"initial","half_year");
    const firstRewardEnd=reward.reward_end;
    await service.activateSubscription(second.event);
    await service.grantReferralReward(secondReferral.id);
    reward=(await admin.query("SELECT * FROM subscription_referrals WHERE id=$1",[secondReferral.id])).rows[0];
    assert.equal(reward.reward_start.getTime(),firstRewardEnd.getTime());
    assert.equal(reward.reward_end.getTime(),calendar.addCalendarMonths(firstRewardEnd,1).getTime());
    assert.equal((await admin.query("SELECT first_paid_transaction_id FROM billing_accounts WHERE id=$1",[c])).rows[0].first_paid_transaction_id,second.id);
    await service.cancelAtPeriodEnd(b,"cancel-paid"); await service.cancelAtPeriodEnd(b,"cancel-paid");
    sub=(await admin.query("SELECT row_to_json(s) AS s FROM subscriptions s WHERE user_id='B'")).rows[0].s;
    assert.equal(sub.cancel_at_period_end,true); assert.equal(policy.evaluateSubscription(sub).hasProAccess,true);
    const bad=await payment(b,"renewal","yearly");
    await assert.rejects(service.activateSubscription(bad.event),/Plan changes/);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM subscription_operations WHERE transaction_id=$1",[bad.id])).rows[0].n,0);
    const wrongIdentity=await payment(b,"renewal");
    await admin.query("UPDATE billing_transactions SET provider_subscription_id='unrelated-sub' WHERE id=$1",[wrongIdentity.id]);
    await assert.rejects(service.activateSubscription(wrongIdentity.event),/identity mismatch/);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM subscription_operations WHERE transaction_id=$1",[wrongIdentity.id])).rows[0].n,0);

    // A has earned time while Free. Paying must append, never overlap or erase it.
    const earnedEnd=(await admin.query("SELECT reward_end FROM subscriptions WHERE user_id='A'")).rows[0].reward_end;
    const aPaid=await payment(a);
    await service.activateSubscription(aPaid.event);
    let aSub=(await admin.query("SELECT row_to_json(s) AS s FROM subscriptions s WHERE user_id='A'")).rows[0].s;
    assert.equal(Date.parse(aSub.current_period_end),calendar.addCalendarMonths(earnedEnd,1).getTime());
    assert.equal(policy.evaluateSubscription(aSub).hasProAccess,true);
    assert.equal(policy.evaluateSubscription(aSub).accessUntil,aSub.current_period_end);
    const aPaidEnd=new Date(aSub.current_period_end);
    assert.equal(await service.isEligibleForTrial(a),false);
    await assert.rejects(service.startTrial(a),/Trial already used/);
    // A second referral while paid queues beyond the paid end, then a renewal preserves both.
    const d=await member("D");
    await service.registerReferral(a,d);
    await service.startTrial(d);
    const tooEarly=await payment(d);
    await assert.rejects(service.activateSubscription(tooEarly.event),/Trial has not ended/);
    await admin.query("UPDATE subscriptions SET trial_start=now()-interval '31 days',trial_end=now()-interval '1 day',current_period_start=now()-interval '31 days',current_period_end=now()-interval '1 day' WHERE user_id='D'");
    await service.activateSubscription(tooEarly.event);
    aSub=(await admin.query("SELECT row_to_json(s) AS s FROM subscriptions s WHERE user_id='A'")).rows[0].s;
    const beforeRenewal=policy.evaluateSubscription(aSub).accessUntil;
    assert.equal(Date.parse(beforeRenewal),calendar.addCalendarMonths(aPaidEnd,1).getTime());
    const aRenewal=await payment(a,"renewal");
    await Promise.all([service.activateSubscription(aRenewal.event),service.activateSubscription(aRenewal.event)]);
    aSub=(await admin.query("SELECT row_to_json(s) AS s FROM subscriptions s WHERE user_id='A'")).rows[0].s;
    assert.equal(Date.parse(aSub.current_period_end),calendar.addCalendarMonths(new Date(beforeRenewal),1).getTime());
    assert.equal(policy.evaluateSubscription(aSub).hasProAccess,true);

    const legacy=await member("legacy");
    await admin.query("INSERT INTO subscriptions(user_id,plan,status,access_source) VALUES('legacy','pro','active','legacy_manual')");
    await assert.rejects(service.cancelAtPeriodEnd(legacy,"preserve-legacy"),/explicit migration/);
    const legacySub=(await admin.query("SELECT row_to_json(s) AS s FROM subscriptions s WHERE user_id='legacy'")).rows[0].s;
    assert.equal(policy.evaluateSubscription(legacySub).hasProAccess,true);
    assert.equal(legacySub.cancel_at_period_end,false);

    await admin.query("UPDATE subscriptions SET current_period_start=now()-interval '2 days',current_period_end=now()-interval '1 day' WHERE user_id='B'");
    await service.expireSubscription(b);
    assert.equal((await admin.query("SELECT status FROM subscriptions WHERE user_id='B'")).rows[0].status,"expired");
    const failed=await payment(b,"renewal","monthly","failed");
    await service.markPaymentFailed(failed.event);
    assert.equal((await admin.query("SELECT status FROM subscriptions WHERE user_id='B'")).rows[0].status,"past_due");
    await assert.rejects(service.activateSubscription(failed.event),/provenance/);
  } finally {
    await adminClient.query("ROLLBACK").catch(()=>{});
    if (created) await adminClient.query(`DROP SCHEMA ${schema} CASCADE`);
    adminClient.release(); await pool.end();
  }
});
