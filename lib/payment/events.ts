import type { PaymentProvider, PaymentSnapshot, SubscriptionSnapshot, VerifiedPaymentEvent } from "./types";
import { validatePayment, validateSnapshot } from "./policy";

export interface EventTransaction {
  // Implementations must lock the account before retrieving fresh provider state.
  account: { id: string; userId: string; customerId: string; priceReference: string; subscriptionId: string | null };
  hasEvent(event: VerifiedPaymentEvent): Promise<boolean>;
  applySubscription(snapshot: SubscriptionSnapshot): Promise<void>;
  savePayment(payment: PaymentSnapshot): Promise<void>;
  markProcessed(event: VerifiedPaymentEvent): Promise<void>;
}

/** Caller MUST wrap all transaction methods in one DB transaction (including event insert).
 * Re-fetching under the account lock prevents old webhook payloads from reverting new state.
 * There is no use of client success parameters or provider metadata alone for ownership.
 */
export async function processPaymentEvent(provider: PaymentProvider, event: VerifiedPaymentEvent, tx: EventTransaction) {
  if (event.provider !== provider.name || event.mode !== provider.mode || event.customerId !== tx.account.customerId) throw new Error("Webhook environment or customer mismatch");
  if (await tx.hasEvent(event)) return { duplicate: true };
  if (tx.account.subscriptionId && event.subscriptionId !== tx.account.subscriptionId) {
    // Historical invoices can still receive refunds after replacement of a subscription.
    if (!event.invoiceId) { await tx.markProcessed(event); return { duplicate: false }; }
    const historical = await provider.getSubscription(event.subscriptionId);
    if (historical.customerId !== tx.account.customerId || historical.userId !== tx.account.userId) throw new Error("Historical subscription mismatch");
    const payment = await provider.getPayment(event.invoiceId);
    validatePayment(payment, historical.id);
    if (payment.invoiceId !== event.invoiceId) throw new Error("Invoice mismatch");
    await tx.savePayment(payment);
    await tx.markProcessed(event);
    return { duplicate: false };
  }
  const snapshot = await provider.getSubscription(event.subscriptionId);
  validateSnapshot(snapshot, { ...tx.account, subscriptionId: event.subscriptionId });
  await tx.applySubscription(snapshot);
  if (event.invoiceId) {
    const payment = await provider.getPayment(event.invoiceId);
    validatePayment(payment, snapshot.id);
    if (payment.invoiceId !== event.invoiceId) throw new Error("Invoice mismatch");
    await tx.savePayment(payment);
  }
  await tx.markProcessed(event);
  return { duplicate: false };
}
