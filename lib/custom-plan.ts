import { EXAM_SUBJECTS, validChapter } from '../data/exam-chapters';
import type { Candidate } from './diagnostic';
import type { DailyReceipt } from './daily-task';

export const CUSTOM_TARGET_MAX = 200;
export type CustomConfig = { target: number | null; deadline: string | null; preferUnanswered: boolean; scope: { subject: string; chapters: string[] }[] };
export function parseCustomConfig(value: unknown): CustomConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join() !== 'deadline,preferUnanswered,scope,target') return null;
  if (row.target !== null && (!Number.isInteger(row.target) || Number(row.target) < 1 || Number(row.target) > CUSTOM_TARGET_MAX)) return null;
  if (row.deadline !== null && (typeof row.deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.deadline) || row.deadline < '1912-01-01' || row.deadline > '2199-12-31' || !Number.isFinite(Date.parse(row.deadline)) || new Date(row.deadline).toISOString().slice(0, 10) !== row.deadline)) return null;
  if (row.target === null && row.deadline === null || typeof row.preferUnanswered !== 'boolean') return null;
  if (!Array.isArray(row.scope) || !row.scope.length || row.scope.length > EXAM_SUBJECTS.length) return null;
  const subjects = new Set<string>();
  for (const part of row.scope) {
    if (!part || typeof part !== 'object' || Object.keys(part).sort().join() !== 'chapters,subject' || !EXAM_SUBJECTS.includes(part.subject) || subjects.has(part.subject) || !Array.isArray(part.chapters)) return null;
    subjects.add(part.subject);
    if (new Set(part.chapters).size !== part.chapters.length || part.chapters.some((chapter: unknown) => typeof chapter !== 'string' || !chapter || !validChapter(part.subject, chapter))) return null;
  }
  return row as CustomConfig;
}
export function inCustomScope(candidate: Pick<Candidate, 'subject' | 'chapter'>, config: CustomConfig) {
  return config.scope.some(row => row.subject === candidate.subject && (!row.chapters.length || candidate.chapter !== null && row.chapters.includes(candidate.chapter)));
}
export function customEstimate(remaining: number, config: CustomConfig, today: string) {
  const days = config.deadline ? Math.max(0, Math.floor((Date.parse(config.deadline) - Date.parse(today)) / 86400000) + 1) : null;
  const suggested = days === null ? null : Math.ceil(remaining / Math.max(1, days));
  const target = config.target ?? Math.min(CUSTOM_TARGET_MAX, Math.max(1, suggested ?? 20));
  const estimatedDays = Math.ceil(remaining / target);
  return { days, suggested, target, estimatedDays, estimatedDate: new Date(Date.parse(today) + Math.max(0, estimatedDays - 1) * 86400000).toISOString().slice(0, 10), overdue: days === 0 && remaining > 0, behind: days !== null && remaining > target * days };
}
export function formatPlanDate(value: string | null) {
  if (!value) return '未設定';
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return `民國 ${year - 1911}/${month}/${day}`;
}
export function parsePlanDate(value: string): string | null {
  if (!value.trim()) return null;
  const match = value.trim().match(/^(\d{1,3})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return 'invalid';
  const date = `${Number(match[1]) + 1911}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  return Number(match[1]) > 0 && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date ? date : 'invalid';
}
export type CustomEstimate = ReturnType<typeof customEstimate> & { total: number; remaining: number; completed: number; excluded: number; correct: number; answered: number };
export type CustomView = {
  mode: 'coach' | 'custom' | null; owner: string; date: string;
  plan: { id: string; config: CustomConfig; status: 'active' | 'paused' | 'completed'; started: string; completedAt: string | null; estimate: CustomEstimate } | null;
  task: { id: string; total: number; target: number; answered: number; completed: boolean; correct: number | null; current: { position: number; question: string; options: string[]; image: string | null } | null } | null;
  history: { date: string; total: number; answered: number }[];
  receipts: DailyReceipt[];
};
