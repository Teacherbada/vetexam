import type { SubscriptionStatus } from "@/lib/subscription-state";

export type PaymentMode = "test" | "live";
export type BillingTerms = {
  plan: "pro_monthly";
  amountMinor: number;
  currency: "TWD";
  trialDays: number;
};
export type CheckoutAttempt = {
  id: string;
  accountId: string;
  customerId: string;
  userId: string;
  priceReference: string;
  terms: BillingTerms;
  returnUrl: string;
  cancelUrl: string;
};
export type HostedCheckout = {
  id: string;
  customerId: string;
  subscriptionId: string | null;
  url: string | null;
  status: "open" | "completed" | "expired";
  expiresAt: string;
};
export type PaymentSnapshot = {
  invoiceId: string;
  paymentId: string | null;
  subscriptionId: string;
  currency: string;
  amountMinor: number;
  // Actual captured funds only. Credits/zero-total invoices are NOT first payment.
  capturedMinor: number;
  refundedMinor: number;
  status: "pending" | "failed" | "paid" | "partially_refunded" | "refunded";
  paidAt: string | null;
};
export type SubscriptionSnapshot = {
  id: string;
  customerId: string;
  userId: string;
  priceReference: string;
  status: Exclude<SubscriptionStatus, "free">;
  trialStart: string | null;
  trialEnd: string | null;
  periodStart: string;
  periodEnd: string;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  paymentMethodBound: boolean;
};
export type VerifiedPaymentEvent = {
  id: string;
  type: string;
  provider: string;
  mode: PaymentMode;
  customerId: string;
  subscriptionId: string;
  invoiceId: string | null;
};

/** A concrete adapter MUST pass contract tests before registration.
 * All SDK calls must be bounded; every create has durable idempotency/recovery.
 * No adapter may accept payment details from a VetExam browser request.
 */
export interface PaymentProvider {
  readonly name: string;
  readonly mode: PaymentMode;
  readonly supportsResume: boolean;
  readonly hostedOrigins: readonly string[];
  validatePrice(reference: string, terms: BillingTerms): Promise<void>;
  // Must recover the SAME customer after response loss, even beyond API-key retention.
  ensureCustomer(input: { accountId: string; userId: string; email: string }): Promise<string>;
  // Must collect a payment method before trial and recover an uncertain previous create.
  createCheckout(attempt: CheckoutAttempt): Promise<HostedCheckout>;
  getCheckout(id: string): Promise<HostedCheckout>;
  getSubscription(id: string): Promise<SubscriptionSnapshot>;
  getPayment(invoiceId: string): Promise<PaymentSnapshot>;
  cancelSubscription(id: string, idempotencyKey: string): Promise<void>;
  resumeSubscription(id: string, idempotencyKey: string): Promise<void>;
  createPortal(customerId: string, returnUrl: string): Promise<string>;
  // Verify raw bytes, timestamp tolerance, account and test/live mode before returning.
  // Unsupported but valid events return null; invalid signatures must throw.
  verifyWebhook(rawBody: Uint8Array, headers: Headers): Promise<VerifiedPaymentEvent | null>;
}
