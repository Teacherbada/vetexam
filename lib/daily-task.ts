import { EXAM_SUBJECTS, validChapter } from '../data/exam-chapters';
import type { Candidate } from './diagnostic';
import { DAILY_TASK_NORMAL_RATIO, DAILY_TASK_WEAKNESS_RATIO, DAILY_TASK_REVIEW_RATIO, MAX_WEAKNESS_RATIO_PER_DAILY_TASK, MAX_CHAPTER_RATIO_PER_DAILY_TASK, DAILY_TASK_RECENT_DAYS, DAILY_TASK_TIME_ZONE, DAILY_TARGET_MIN, DAILY_TARGET_MAX } from './daily-task-config';
import { FOLLOW_UP_QUESTION_COUNT } from './follow-up-config';
export type DailyCandidate = Candidate & { last_seen: string | null; appearances: number };
export type DailySource = 'normal' | 'weakness' | 'follow_up';
export type DailyReceipt = { eventId: string; id: number; subject: string; question: string; options: string[]; answer: string; explanation: string; image: string | null; userAnswer: string; correct: boolean };
export type DailyView = {
  mode: string | null; owner: string; date: string; target: number;
  active: { subject: string; chapter: string; status: string } | null;
  next: 'reinforcement' | 'analysis' | 'done';
  task: null | { id: string; target: number; total: number; answered: number; completed: boolean; correct: number | null;
    current: null | { position: number; question: string; options: string[]; image: string | null };
    summary: { source: DailySource; total: number; correct: number }[]; followUpsCompleted: number };
  receipts: DailyReceipt[];
};
export function dailyLocalDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DAILY_TASK_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function dailyQuotas(target: number) {
  const sum = DAILY_TASK_NORMAL_RATIO + DAILY_TASK_WEAKNESS_RATIO + DAILY_TASK_REVIEW_RATIO;
  const weakness = Math.min(Math.floor(target * MAX_WEAKNESS_RATIO_PER_DAILY_TASK), Math.floor(target * DAILY_TASK_WEAKNESS_RATIO / sum));
  const review = Math.min(target, Math.max(FOLLOW_UP_QUESTION_COUNT, Math.round(target * DAILY_TASK_REVIEW_RATIO / sum)));
  return { weakness, review };
}
export function validDailyTarget(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= DAILY_TARGET_MIN && value <= DAILY_TARGET_MAX; }
export function selectDailyQuestions(candidates: DailyCandidate[], target: number, reserved: Candidate[], weaknesses: { subject: string; chapter: string | null }[], now = Date.now(), random = Math.random) {
  const used = new Set(reserved.map(row => row.id));
  const key = (row: Pick<Candidate, 'subject' | 'chapter'>) => JSON.stringify([row.subject, row.chapter]);
  const weak = new Set(weaknesses.filter(row => row.chapter && validChapter(row.subject, row.chapter)).map(key));
  const subjectCounts = new Map(EXAM_SUBJECTS.map(subject => [subject, reserved.filter(row => row.subject === subject).length]));
  const lifetime = new Map(EXAM_SUBJECTS.map(subject => [subject, candidates.filter(row => row.subject === subject && row.last_answered).length]));
  const chapterCounts = new Map<string, number>();
  for (const row of reserved) chapterCounts.set(key(row), (chapterCounts.get(key(row)) ?? 0) + 1);
  const pool = [...new Map(candidates.map(row => [row.id,row])).values()].filter(row => EXAM_SUBJECTS.includes(row.subject) && !used.has(row.id)).map(row => ({ ...row, tie: random() }));
  const cutoff = now - DAILY_TASK_RECENT_DAYS * 86400000;
  const tier = (row: DailyCandidate) => row.last_seen && Date.parse(row.last_seen) >= cutoff ? 2 : row.last_answered ? 1 : 0;
  const time = (row: DailyCandidate) => row.last_answered ? Date.parse(row.last_answered) : 0;
  const chapterCap = Math.max(1, Math.floor(target * MAX_CHAPTER_RATIO_PER_DAILY_TASK));
  const selected: (DailyCandidate & { source: 'normal' | 'weakness' })[] = [];
  function pick(source: 'normal' | 'weakness', amount: number) {
    for (let n = 0; n < amount; n++) {
      const eligible = pool.filter(row => !used.has(row.id) && (source === 'normal' || weak.has(key(row))) &&
        (!row.chapter || !validChapter(row.subject, row.chapter) || (chapterCounts.get(key(row)) ?? 0) < chapterCap));
      eligible.sort((a,b) => tier(a)-tier(b) || (subjectCounts.get(a.subject) ?? 0)-(subjectCounts.get(b.subject) ?? 0) ||
        (chapterCounts.get(key(a)) ?? 0)-(chapterCounts.get(key(b)) ?? 0) || (lifetime.get(a.subject) ?? 0)-(lifetime.get(b.subject) ?? 0) ||
        time(a)-time(b) || a.appearances-b.appearances || a.tie-b.tie || a.id-b.id);
      const row = eligible[0]; if (!row) break;
      selected.push({ ...row, source }); used.add(row.id);
      subjectCounts.set(row.subject, (subjectCounts.get(row.subject) ?? 0)+1); chapterCounts.set(key(row),(chapterCounts.get(key(row)) ?? 0)+1);
    }
  }
  pick('weakness', Math.min(dailyQuotas(target).weakness, Math.max(0,target-reserved.length)));
  pick('normal', Math.max(0,target-reserved.length-selected.length));
  return selected.map(row => ({ row, tie: random() })).sort((a,b)=>a.tie-b.tie).map(item=>item.row);
}
export function interleaveDailyStreams<T>(streams: T[][], random = Math.random): T[] {
  const queues = streams.map(stream => [...stream]); const result: T[] = [];
  while (queues.some(queue => queue.length)) {
    let index = Math.floor(random() * queues.reduce((sum, queue) => sum + queue.length, 0));
    for (const queue of queues) { if (index < queue.length) { result.push(queue.shift()!); break; } index -= queue.length; }
  }
  return result;
}
