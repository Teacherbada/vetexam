// Keep AI practice usable on the site's Safari 15.5 browser target.
export async function fetchAI(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    await response.clone().arrayBuffer();
    return response;
  } finally { clearTimeout(timer); }
}
