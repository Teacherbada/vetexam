import "server-only";
import { neon } from "@neondatabase/serverless";
import { auth } from "@/lib/auth";
import { evaluateSubscription, type SubscriptionRecord } from "@/lib/subscription-state";

// Accept headers, never a caller-supplied user ID or role. No shared cross-user cache.
export async function getUserSubscription(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!session?.user?.id) return null;
  if (!process.env.DATABASE_URL) throw new Error("Subscription database unavailable");
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`
    SELECT id, user_id, plan, status, expires_at, trial_start, trial_end,
      current_period_start, current_period_end, cancel_at_period_end, canceled_at,
      access_source, provider, provider_customer_id, provider_subscription_id,
      created_at, updated_at, NOW() AS checked_at
    FROM subscriptions WHERE user_id = ${session.user.id} LIMIT 1
  `;
  const record = (rows[0] ?? null) as (SubscriptionRecord & { checked_at: string }) | null;
  const access = evaluateSubscription(record, record ? new Date(record.checked_at) : new Date());
  // Provider identifiers and internal grant provenance stay on the server.
  const subscription = record ? {
    id: record.id, user_id: record.user_id, plan: record.plan, status: access.status,
    expires_at: record.expires_at, trial_start: record.trial_start, trial_end: record.trial_end,
    current_period_start: record.current_period_start, current_period_end: record.current_period_end,
    cancel_at_period_end: record.cancel_at_period_end, canceled_at: record.canceled_at,
    created_at: record.created_at, updated_at: record.updated_at,
  } : null;
  return {
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    subscription,
    access,
  };
}

export async function hasProAccess(headers: Headers) {
  return (await getUserSubscription(headers))?.access.hasProAccess ?? false;
}
