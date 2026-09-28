export const AUTH_SESSION_TIMEOUT_MS = 15000;

// Better Auth supplies its own signal, which disables better-fetch's timeout.
// Keep that cancellation behavior, but give the session request its own deadline.
export async function fetchAuthSession(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  if (new URL(url, 'https://session.invalid').pathname !== '/api/auth/get-session') {
    return fetch(input, init);
  }

  const parentSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => {};
  const deadline = new Promise<never>((_, reject) => {
    cancel = () => {
      reject(new DOMException('Session request cancelled', 'AbortError'));
      controller.abort();
    };
    if (parentSignal?.aborted) { cancel(); return; }
    parentSignal?.addEventListener('abort', cancel, { once: true });
    timeout = setTimeout(() => {
      // Reject independently: even a stalled fetch/body must settle the session hook.
      reject(new Error('AUTH_SESSION_TIMEOUT'));
      controller.abort();
      console.error('AUTH_SESSION_FETCH_FAILED', { stage: 'client.session', reason: 'timeout' });
    }, AUTH_SESSION_TIMEOUT_MS);
  });

  try {
    const response = (async () => {
      const result = await fetch(input, { ...init, signal: controller.signal });
      // Fetch resolves at headers; include receiving the body in the deadline too.
      await result.clone().arrayBuffer();
      return result;
    })();
    return await Promise.race([response, deadline]);
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', cancel);
  }
}
