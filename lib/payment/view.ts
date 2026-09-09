import "server-only";
import { getBillingTerms } from "./config";
import { paymentAvailable, getPaymentProvider } from "./provider";
import { billingTransaction } from "./db";

export async function getBillingView(userId?: string) {
  const terms = getBillingTerms();
  const enabled = paymentAvailable();
  const defaults = { enabled, managed: false, canResume: false, trialEligible: false, terms };
  if (!enabled || !userId) return defaults;
  const provider = getPaymentProvider();
  return billingTransaction(async client => {
    const result = await client.query(`SELECT a.trial_started_at,s.trial_start,s.provider,s.provider_subscription_id,
      c.amount_minor FROM subscriptions s LEFT JOIN billing_accounts a ON a.user_id=s.user_id
      LEFT JOIN LATERAL (SELECT amount_minor FROM billing_checkouts WHERE account_id=a.id
        AND provider=$2 AND mode=$3 ORDER BY created_at DESC LIMIT 1) c ON true
      WHERE s.user_id=$1`, [userId, provider.name, provider.mode]);
    const row = result.rows[0];
    return { enabled, managed: Boolean(row?.provider === provider.name && row?.provider_subscription_id),
      canResume: provider.supportsResume, trialEligible: false,
      terms: { ...terms, amountMinor: row?.amount_minor ?? terms.amountMinor } };
  });
}
