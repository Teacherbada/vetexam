import "server-only";
import type { PaymentProvider } from "./types";
import { getPaymentConfiguration } from "./config";
import { BillingError } from "./policy";

// Intentionally empty: the owner has not chosen a merchant/payment provider.
// Register a real, contract-tested SDK adapter here; never install a mock in production.
const providers: Record<string, () => PaymentProvider> = {};
export function paymentAvailable() {
  const config = getPaymentConfiguration();
  return config.enabled && Object.hasOwn(providers, config.provider);
}
export function getPaymentProvider(): PaymentProvider {
  const config = getPaymentConfiguration();
  if (!config.enabled || !Object.hasOwn(providers, config.provider)) {
    throw new BillingError("PAYMENT_NOT_CONFIGURED", 503, "付款功能尚未開放，暫時不會產生扣款。");
  }
  const provider = providers[config.provider]();
  if (provider.name !== config.provider || provider.mode !== config.mode) throw new Error("Payment environment mismatch");
  return provider;
}
