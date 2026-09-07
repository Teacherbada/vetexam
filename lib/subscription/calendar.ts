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
