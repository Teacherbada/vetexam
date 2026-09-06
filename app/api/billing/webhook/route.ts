import { billingWebhook } from "@/lib/payment/http";
export const runtime = "nodejs";
export async function POST(request: Request) { return billingWebhook(request); }
