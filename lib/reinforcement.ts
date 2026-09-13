import { validChapter } from "../data/exam-chapters";
import type { Candidate, DiagnosticView } from "./diagnostic";
import type { Performance, WeaknessAnalysis } from "./weakness";
import type { FollowUp } from './follow-up';

export const REINFORCEMENT_VERIFICATION_QUESTION_COUNT = 5;
export const REINFORCEMENT_PASS_THRESHOLD = 0.8;
export const REINFORCEMENT_MIN_VERIFICATION_QUESTIONS = 3;
export const REINFORCEMENT_RECENT_DAYS = 7;
export type ReinforcementStatus = "reviewing" | "reviewed" | "verifying" | "short_term" | "needs_work" | "deferred" | "stable" | "queued";
export const REINFORCEMENT_LABELS: Record<ReinforcementStatus, string> = {
  reviewing: "補強中・等待複習", reviewed: "補強中・等待確認", verifying: "補強中・確認測驗進行中",
  short_term: "短期掌握", needs_work: "仍需加強", deferred: "需要補強・稍後複習",
  stable: "掌握穩定", queued: "需要再次補強",
};
export type VerificationMetadata = {
  review_attempt: number; reviewed_at: string; repeated_question_ids: number[];
  pass_threshold: number; min_questions: number;
};
export type VerificationAttempt = {
  id: string; attempt: number; reviewedAt: string; total: number; answered: number; correct: number;
  completedAt: string | null; repeatedCount: number; passThreshold: number; minQuestions: number;
};
export type ReinforcementTask = {
  id: string; subject: string; chapter: string; status: ReinforcementStatus; source_analysis: Performance;
  source_session_id: string; review_count: number; created_at: string; started_at: string;
  review_completed_at: string | null; verification_completed_at: string | null;
};
export type ReinforcementView = {
  mode: string | null; task: ReinforcementTask | null; next: Performance | null;
  session: DiagnosticView["session"]; attempts: VerificationAttempt[];
  completed: { subject: string; chapter: string; baseline: number | null; correct: number; total: number; status: ReinforcementStatus }[];
  due: FollowUp[];
};
export type ReinforcementCommand = {
  action: "review" | "verify" | "again" | "defer" | "resume";
  taskId: string; reviewAttempt: number;
};
export function validTaskId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}
export function parseReinforcementCommand(value: unknown): ReinforcementCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 3 || !Object.keys(row).every(key => ["action", "taskId", "reviewAttempt"].includes(key)) ||
    !validTaskId(row.taskId) || typeof row.action !== "string" || !["review", "verify", "again", "defer", "resume"].includes(row.action) ||
    !Number.isSafeInteger(row.reviewAttempt) || Number(row.reviewAttempt) < 1) return null;
  return row as ReinforcementCommand;
}
export function reinforcementPassed(correct: number, total: number, threshold = REINFORCEMENT_PASS_THRESHOLD, minimum = REINFORCEMENT_MIN_VERIFICATION_QUESTIONS) {
  return total >= minimum && correct / total >= threshold;
}

export function nextReinforcement(analysis: WeaknessAnalysis, completed: { subject: string; chapter: string }[]): Performance | null {
  const done = new Set(completed.map(row => JSON.stringify([row.subject, row.chapter])));
  return analysis.subjects.flatMap(row => row.chapters).filter(row => row.chapter &&
    (row.status === "strengthen" || row.status === "review") && !done.has(JSON.stringify([row.subject, row.chapter])))
    .sort((a, b) => (a.status === "strengthen" ? 0 : 1) - (b.status === "strengthen" ? 0 : 1) ||
      a.recentAccuracy! - b.recentAccuracy! || b.distinctErrors - a.distinctErrors || b.count - a.count)[0] ?? null;
}

export function selectVerificationQuestions(candidates: Candidate[], subject: string, chapter: string, excluded: Set<number>, random = Math.random) {
  if (!chapter || !validChapter(subject, chapter)) return [];
  return [...new Map(candidates.map(row => [row.id, row])).values()]
    .filter(row => row.subject === subject && row.chapter === chapter)
    .map(row => ({ ...row, tie: random() }))
    .sort((a, b) => Number(excluded.has(a.id)) - Number(excluded.has(b.id)) ||
      Number(Boolean(a.last_answered)) - Number(Boolean(b.last_answered)) ||
      (a.last_answered ? Date.parse(a.last_answered) : 0) - (b.last_answered ? Date.parse(b.last_answered) : 0) || a.tie - b.tie || a.id - b.id)
    .slice(0, REINFORCEMENT_VERIFICATION_QUESTION_COUNT);
}
