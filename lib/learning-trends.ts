import type { History } from './learning-client';
export const TREND_MIN_QUESTIONS = 10;
const DAY = 86400000;
export function learningTrends(history: History[], now = Date.now()) {
  function windowSummary(start: number, end: number, subject?: string) {
    const latest = new Map<number, History>();
    for (const row of history) {
      const time = Date.parse(row.answered_at);
      if (time < start || time >= end || !Number.isFinite(time) || subject && row.subject !== subject) continue;
      const previous = latest.get(row.question_id);
      if (!previous || time > Date.parse(previous.answered_at)) latest.set(row.question_id, row);
    }
    const count = latest.size;
    const correct = [...latest.values()].filter(row => row.is_correct).length;
    return { count, correct, accuracy: count >= TREND_MIN_QUESTIONS ? correct / count * 100 : null };
  }
  const recent = windowSummary(now - 7 * DAY, now + 1);
  const previous = windowSummary(now - 14 * DAY, now - 7 * DAY);
  const change = (a: typeof recent, b: typeof recent) => a.accuracy === null || b.accuracy === null ? null : a.accuracy - b.accuracy;
  return { recent, previous, month: windowSummary(now - 30 * DAY, now + 1), all: windowSummary(0, now + 1), change: change(recent, previous),
    subjects: [...new Set(history.map(row => row.subject))].map(subject => {
      const recent = windowSummary(now - 7 * DAY, now + 1, subject), previous = windowSummary(now - 14 * DAY, now - 7 * DAY, subject);
      return { subject, recent, previous, change: change(recent, previous) };
    }) };
}
