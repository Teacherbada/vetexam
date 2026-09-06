import "server-only";
import { auth } from "@/lib/auth";
import { getPaymentConfiguration } from "./config";
import { getPaymentProvider } from "./provider";
import { BillingError } from "./policy";
import { billingTransaction } from "./db";
import { createCheckout, manageBilling, processWebhook } from "./service";

export type BillingAction = "checkout" | "cancel" | "resume" | "portal" | "sync";
const responseHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
function failure(error: unknown) {
  if (error instanceof BillingError) return Response.json({ code: error.code, error: error.message }, { status: error.status, headers: responseHeaders });
  console.error("Billing operation unavailable");
  return Response.json({ error: "付款服務暫時無法使用，請稍後重試。" }, { status: 503, headers: responseHeaders });
}
export async function billingAction(request: Request, action: BillingAction) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user?.id) throw new BillingError("UNAUTHENTICATED", 401, "請先登入再管理訂閱。");
    getPaymentProvider(); // Fail closed before any write when a real provider is not configured.
    const config = getPaymentConfiguration();
    if (request.headers.get("origin") !== config.origin || request.headers.get("sec-fetch-site") === "cross-site") {
      throw new BillingError("INVALID_ORIGIN", 403, "請從 VetExam 訂閱頁面操作。");
    }
    // Routes take no user IDs, prices, trial flags, provider IDs or return URLs in the body.
    const permitted = await billingTransaction(async client => {
      const result = await client.query(`INSERT INTO billing_rate_limits(user_id) VALUES($1)
        ON CONFLICT(user_id) DO UPDATE SET
          requests=CASE WHEN billing_rate_limits.window_start < now()-interval '1 minute' THEN 1 ELSE billing_rate_limits.requests+1 END,
          window_start=CASE WHEN billing_rate_limits.window_start < now()-interval '1 minute' THEN now() ELSE billing_rate_limits.window_start END
        RETURNING requests`, [session.user.id]);
      return result.rows[0].requests <= 10;
    });
    if (!permitted) throw new BillingError("RATE_LIMITED", 429, "操作較頻繁，請稍候一分鐘再試。");
    const result = action === "checkout" ? await createCheckout(session.user) : await manageBilling(session.user, action);
    return Response.json(result, { headers: responseHeaders });
  } catch (error) { return failure(error); }
}
export async function billingWebhook(request: Request) {
  try {
    getPaymentProvider();
    // Bound streaming input before allocation; no JSON parsing before signature verification.
    const reader = request.body?.getReader();
    if (!reader) throw new BillingError("EMPTY_WEBHOOK", 400, "Missing webhook body");
    const parts: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 1_048_576) { await reader.cancel(); throw new BillingError("WEBHOOK_TOO_LARGE", 413, "Webhook too large"); }
      parts.push(part.value);
    }
    const result = await processWebhook(Buffer.concat(parts), request.headers);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
