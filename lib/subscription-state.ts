export type SubscriptionStatus = "free" | "trialing" | "active" | "past_due" | "canceled" | "expired";
export type SubscriptionRecord = {
  id: number;
  user_id: string;
  plan: "free" | "pro";
  status: SubscriptionStatus | "cancelled";
  expires_at: string | null;
  trial_start: string | null;
  trial_end: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  access_source: string | null;
  provider: string | null;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  created_at: string;
  updated_at: string;
  billing_plan?: "monthly" | "half_year" | "yearly" | null;
  reward_start?: string | null;
  reward_end?: string | null;
};

// Pure policy, called with trusted database records by the server service.
export function evaluateSubscription(record: SubscriptionRecord | null, now = new Date()) {
  const time = now.getTime();
  const storedStatus = record?.status === "cancelled" ? "canceled" : record?.status ?? "free";
  let status: SubscriptionStatus = storedStatus;
  let hasProAccess = false;
  const end = record?.current_period_end ?? record?.expires_at ?? null;
  const validWindow = (start: string | null, finish: string | null) =>
    finish !== null && Number.isFinite(Date.parse(finish)) && Date.parse(finish) > time &&
    (start === null || (Number.isFinite(Date.parse(start)) && Date.parse(start) <= time && Date.parse(start) < Date.parse(finish)));

  if (!record || record.plan === "free") {
    status = "free";
  } else if (record.plan === "pro") {
    if (storedStatus === "trialing") {
      hasProAccess = record.trial_start !== null && validWindow(record.trial_start, record.trial_end);
      if (record.trial_end !== null && Date.parse(record.trial_end) <= time) status = "expired";
    } else if (storedStatus === "active" || storedStatus === "canceled") {
      hasProAccess = validWindow(record.current_period_start, end);
      // Only explicitly migrated grants retain unbounded access, never new records with a missing expiry.
      if (storedStatus === "active" && record.access_source === "legacy_manual" &&
          !record.provider && !record.provider_subscription_id && end === null && !record.cancel_at_period_end &&
          (record.current_period_start === null || Date.parse(record.current_period_start) <= time)) hasProAccess = true;
      if (end !== null && Date.parse(end) <= time) status = "expired";
    }
  }

  const baseAccess = hasProAccess;
  let accessUntil = hasProAccess ? (storedStatus === "trialing" ? record!.trial_end : end) : null;
  // Independently earned time does not change paid periods or provider renewal dates.
  const rewardStart = record?.reward_start ?? null, rewardEnd = record?.reward_end ?? null;
  const rewardActive = rewardStart !== null && validWindow(rewardStart, rewardEnd);
  const contiguousReward = baseAccess && accessUntil !== null && rewardStart !== null && rewardEnd !== null &&
    Number.isFinite(Date.parse(rewardStart)) && Number.isFinite(Date.parse(rewardEnd)) &&
    Date.parse(rewardStart) <= Date.parse(accessUntil) && Date.parse(rewardEnd) > Date.parse(accessUntil);
  if (rewardActive || contiguousReward) {
    hasProAccess = true;
    if (!baseAccess || accessUntil !== null) {
      accessUntil = accessUntil && Date.parse(accessUntil) >= Date.parse(rewardEnd!) ? accessUntil : rewardEnd;
    }
    if (!baseAccess) status = "active";
  }
  const renewalCanceled = record?.cancel_at_period_end === true || storedStatus === "canceled";
  return {
    plan: hasProAccess ? "pro" as const : "free" as const,
    status,
    storedStatus,
    hasProAccess,
    accessUntil,
    renewalCanceled,
    // Manual grants do not imply recurring billing.
    nextRenewalAt: baseAccess && storedStatus === "active" && !renewalCanceled &&
      record?.provider && record.provider_subscription_id ? end : null,
    trialDaysRemaining: baseAccess && storedStatus === "trialing" && record?.trial_end
      ? Math.ceil((Date.parse(record.trial_end) - time) / 86_400_000) : 0,
    checkedAt: now.toISOString(),
  };
}

export type SubscriptionAccess = ReturnType<typeof evaluateSubscription>;
