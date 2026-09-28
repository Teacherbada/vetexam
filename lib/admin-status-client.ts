// Share only simultaneous requests for the same account; no persistent role cache.
const pending = new Map<string, Promise<boolean>>();
export function readAdminStatus(userId: string): Promise<boolean> {
  const existing = pending.get(userId);
  if (existing) return existing;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const task = fetch('/api/admin/status', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
    .then(response => response.ok ? response.json() : null)
    .then(data => data?.isAdmin === true)
    .catch(() => false)
    .finally(() => { clearTimeout(timeout); if (pending.get(userId) === task) pending.delete(userId); });
  pending.set(userId, task);
  return task;
}
