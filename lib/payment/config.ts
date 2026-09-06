import "server-only";
import type { BillingTerms, PaymentMode } from "./types";

function integer(name: string, fallback: number, max: number) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${name}`);
  return value;
}
export function getBillingTerms(): BillingTerms {
  return { plan: "pro_monthly", amountMinor: integer("PRO_MONTHLY_AMOUNT_MINOR", 19900, 100_000_000),
    currency: "TWD", trialDays: integer("PRO_TRIAL_DAYS", 30, 365) };
}
export function getPaymentConfiguration() {
  const mode = process.env.PAYMENT_MODE ?? "test";
  if (mode !== "test" && mode !== "live") throw new Error("Invalid PAYMENT_MODE");
  const provider = process.env.PAYMENT_PROVIDER ?? "";
  const enabled = process.env.PAYMENT_ENABLED === "true";
  if (enabled && mode === "test" && process.env.VERCEL_ENV === "production") throw new Error("Test payments require an isolated preview/local environment");
  if (mode === "live" && (process.env.VERCEL_ENV !== "production" || process.env.PAYMENT_LIVE_CONFIRMED !== "true")) {
    throw new Error("Live payments require an explicitly configured production deployment");
  }
  const origin = process.env.BILLING_APP_ORIGIN ?? "";
  if (enabled) {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password ||
      (url.protocol !== "https:" && !(mode === "test" && url.hostname === "localhost"))) throw new Error("Invalid billing origin");
    if (!provider || !process.env.PAYMENT_PRICE_ID) throw new Error("Payment provider configuration missing");
  }
  return { enabled, mode: mode as PaymentMode, provider, origin,
    priceReference: process.env.PAYMENT_PRICE_ID ?? "", terms: getBillingTerms() };
}
