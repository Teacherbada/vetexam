// TWD amounts are whole dollars. Provider adapters convert to minor units at their boundary.
export const PRO_PLANS = [
  { key: "monthly", name: "月繳方案", description: "彈性使用", price: 199, months: 1, period: "月", originalPrice: null },
  { key: "half_year", name: "半年方案", description: "適合一段完整備考期", price: 1095, months: 6, period: "6 個月", originalPrice: 1194 },
  { key: "yearly", name: "年度方案", description: "適合長期完整備考", price: 2189, months: 12, period: "年", originalPrice: 2388 },
] as const;

export function money(amount: number) {
  return `NT$${amount.toLocaleString("zh-TW")}`;
}

export type SubscriptionPlan = typeof PRO_PLANS[number]["key"];
export const TRIAL_DAYS = 30;
export function subscriptionPlan(key: string) {
  const plan = PRO_PLANS.find(plan => plan.key === key);
  if (!plan) throw new Error("Unknown subscription plan");
  return plan;
}
