/** Add calendar months in Asia/Taipei, clamping month-end (Jan 31 -> Feb 28/29).
 * Taiwan has a fixed UTC+08 offset for modern subscription dates.
 */
export function addCalendarMonths(value: Date, months: number): Date {
  if (!Number.isFinite(value.getTime()) || !Number.isInteger(months) || months < 1 || months > 120) throw new Error("Invalid calendar period");
  const local = new Date(value.getTime() + 8 * 3600000);
  const day = local.getUTCDate();
  local.setUTCDate(1);
  local.setUTCMonth(local.getUTCMonth() + months);
  const last = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
  local.setUTCDate(Math.min(day, last));
  return new Date(local.getTime() - 8 * 3600000);
}

/** Preserve the original billing day across a short month (Jan 31 -> Feb 28 -> Mar 31).
 * A gap or earned-time extension starts a new anchor rather than guessing a provider schedule.
 */
export function nextCalendarPeriodEnd(start: Date, months: number, anchor: Date | null): Date {
  if (!Number.isFinite(start.getTime()) || !Number.isInteger(months) || months < 1 || months > 120) throw new Error("Invalid calendar period");
  if (anchor && Number.isFinite(anchor.getTime()) && anchor.getTime() <= start.getTime()) {
    const localStart = new Date(start.getTime() + 8 * 3600000);
    const localAnchor = new Date(anchor.getTime() + 8 * 3600000);
    const elapsed = (localStart.getUTCFullYear() - localAnchor.getUTCFullYear()) * 12 + localStart.getUTCMonth() - localAnchor.getUTCMonth();
    if (elapsed > 0 && elapsed + months <= 120 && addCalendarMonths(anchor, elapsed).getTime() === start.getTime()) {
      return addCalendarMonths(anchor, elapsed + months);
    }
  }
  return addCalendarMonths(start, months);
}
