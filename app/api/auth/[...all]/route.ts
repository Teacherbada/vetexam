import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { logAuthEvent } from "@/lib/auth-diagnostics";

export const runtime = "nodejs";
const handlers = toNextJsHandler(auth);

async function handle(request: Request, method: 'GET' | 'POST') {
  const isSession = new URL(request.url).pathname === '/api/auth/get-session';
  try {
    const response = await handlers[method](request);
    response.headers.set('Cache-Control', 'private, no-store');
    const vary = response.headers.get('Vary');
    response.headers.set('Vary', vary ? `${vary}, Cookie` : 'Cookie');
    if (!response.ok) {
      logAuthEvent(isSession ? 'AUTH_SESSION_FETCH_FAILED' : 'AUTH_REQUEST_FAILED', request.headers, 'auth.handler', response.status);
    } else if (isSession) {
      const session = await response.clone().json();
      if (!session) logAuthEvent('AUTH_SESSION_MISSING', request.headers, 'auth.get-session', response.status);
      else if (!session.user?.id) logAuthEvent('USER_FETCH_FAILED', request.headers, 'auth.get-session', response.status);
    }
    return response;
  } catch {
    logAuthEvent(isSession ? 'AUTH_SESSION_FETCH_FAILED' : 'AUTH_REQUEST_FAILED', request.headers, 'auth.handler', 503);
    return Response.json({ error: '暫時無法確認帳號，請稍後再試。' }, { status: 503, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
  }
}

export const GET = (request: Request) => handle(request, 'GET');
export const POST = (request: Request) => handle(request, 'POST');
