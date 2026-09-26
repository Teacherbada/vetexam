// Share only simultaneous requests for the same account; no persistent role cache.
const pending = new Map<string, Promise<boolean>>();
export function readAdminStatus(userId: string): Promise<boolean> {
  const existing = pending.get(userId);
  if (existing) return existing;
  const task = fetch('/api/admin/status', { cache: 'no-store', signal: AbortSignal.timeout(10000) })
    .then(response => response.ok ? response.json() : null)
    .then(data => data?.isAdmin === true)
    .catch(() => false)
    .finally(() => { if (pending.get(userId) === task) pending.delete(userId); });
  pending.set(userId, task);
  return task;
}
