import type { PaymentSnapshot, SubscriptionSnapshot, PaymentProvider } from "./types";

export class BillingError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}
export function assertHostedUrl(value: string, provider: Pick<PaymentProvider, "hostedOrigins">) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || !provider.hostedOrigins.includes(url.origin)) {
    throw new BillingError("UNSAFE_PROVIDER_URL", 502, "付款平台回應異常，請稍後再試。");
  }
  return value;
}
export function validateSnapshot(snapshot: SubscriptionSnapshot, expected: { customerId: string; userId: string; subscriptionId: string; priceReference: string }) {
  for (const [actual, required] of [[snapshot.customerId, expected.customerId], [snapshot.userId, expected.userId],
    [snapshot.id, expected.subscriptionId], [snapshot.priceReference, expected.priceReference]]) {
    if (!actual || actual !== required) throw new BillingError("SUBSCRIPTION_MISMATCH", 409, "訂閱資料需要核對。");
  }
  if (!["trialing", "active", "past_due", "canceled", "expired"].includes(snapshot.status)) throw new Error("Unknown subscription state");
  const start = Date.parse(snapshot.periodStart), end = Date.parse(snapshot.periodEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("Invalid billing period");
  if (snapshot.status === "trialing" && (!snapshot.paymentMethodBound || !snapshot.trialStart || !snapshot.trialEnd ||
    !Number.isFinite(Date.parse(snapshot.trialStart)) || !Number.isFinite(Date.parse(snapshot.trialEnd)) ||
    Date.parse(snapshot.trialEnd) <= Date.parse(snapshot.trialStart))) throw new Error("Invalid trial or missing payment method");
}
export function validatePayment(payment: PaymentSnapshot, subscriptionId: string) {
  if (!payment.invoiceId || payment.subscriptionId !== subscriptionId || !/^[A-Z]{3}$/.test(payment.currency)) throw new Error("Invalid payment identity");
  for (const amount of [payment.amountMinor, payment.capturedMinor, payment.refundedMinor]) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Invalid payment amount");
  }
  if (payment.refundedMinor > payment.capturedMinor || payment.capturedMinor > payment.amountMinor) throw new Error("Inconsistent refund");
  if (payment.capturedMinor > 0 && (!payment.paymentId || !payment.paidAt || !Number.isFinite(Date.parse(payment.paidAt)))) throw new Error("Missing actual payment evidence");
  if (!["pending", "failed", "paid", "partially_refunded", "refunded"].includes(payment.status)) throw new Error("Invalid payment status");
  if (payment.status === "refunded" && (payment.capturedMinor === 0 || payment.refundedMinor !== payment.capturedMinor)) throw new Error("Invalid full refund");
  if (payment.status === "partially_refunded" && !(payment.refundedMinor > 0 && payment.refundedMinor < payment.capturedMinor)) throw new Error("Invalid partial refund");
  if (payment.status === "paid" && payment.refundedMinor !== 0) throw new Error("Unreported refund");
}
