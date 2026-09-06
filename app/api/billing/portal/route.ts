import { billingAction } from "@/lib/payment/http";
export const runtime = "nodejs";
export async function POST(request: Request) { return billingAction(request, "portal"); }
