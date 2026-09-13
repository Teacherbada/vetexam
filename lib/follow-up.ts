import { validChapter } from '../data/exam-chapters';
import type { Candidate, DiagnosticView } from './diagnostic';
import { FOLLOW_UP_QUESTION_COUNT, FOLLOW_UP_RECENT_DAYS } from './follow-up-config';

export type FollowUp = {
  id: string; subject: string; chapter: string; reinforcement_task_id: string; review_attempt: number;
  stage: number; due_at: string; status: 'pending' | 'due' | 'completed' | 'failed' | 'cancelled';
  session_id: string | null; completed_at: string | null; intervals: number[];
  result: { correct: number; total: number; passed: boolean; reused: number; sufficient: boolean } | null;
};
export type FollowUpView = { mode: string | null; followUp: FollowUp | null; session: DiagnosticView['session']; history: FollowUp[]; activeReinforcement: boolean };
export type FollowUpCandidate = Candidate & { appearances: number; last_seen: string | null; previous: boolean };
export function selectFollowUpQuestions(candidates: FollowUpCandidate[], subject: string, chapter: string, now = Date.now(), random = Math.random) {
  if (!validChapter(subject, chapter)) return [];
  const cutoff = now - FOLLOW_UP_RECENT_DAYS * 86400000;
  return [...new Map(candidates.map(row => [row.id, row])).values()].filter(row => row.subject === subject && row.chapter === chapter)
    .map(row => ({ ...row, tie: random(), recent: Boolean(row.last_seen && Date.parse(row.last_seen) >= cutoff) }))
    .sort((a, b) => Number(a.recent) - Number(b.recent) || Number(a.previous) - Number(b.previous) ||
      Number(Boolean(a.last_answered)) - Number(Boolean(b.last_answered)) ||
      (a.last_answered ? Date.parse(a.last_answered) : 0) - (b.last_answered ? Date.parse(b.last_answered) : 0) ||
      a.appearances - b.appearances || a.tie - b.tie || a.id - b.id)
    .slice(0, FOLLOW_UP_QUESTION_COUNT);
}
