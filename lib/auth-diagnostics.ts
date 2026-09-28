type AuthEvent = 'AUTH_SESSION_FETCH_FAILED' | 'AUTH_SESSION_MISSING' | 'USER_FETCH_FAILED' | 'SUBSCRIPTION_FETCH_FAILED' | 'AUTH_REQUEST_FAILED';

// Only allowlisted metadata. Never pass an Error, URL query, user, or cookie value.
export function logAuthEvent(event: AuthEvent, headers: Headers, stage: string, status?: number) {
  const cookie = headers.get('cookie') ?? '';
  const metadata = {
    stage,
    status,
    hasSessionCookie: /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/.test(cookie),
  };
  if (event === 'AUTH_SESSION_MISSING') console.info(event, metadata);
  else console.error(event, metadata);
}
