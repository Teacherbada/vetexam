import type { QuestionState } from './question-state';
export function buildQuizUrl(groups: { subject: string; years: number[]; count: string; chapter?: string }[], order: string, mode: string, state: QuestionState) {
  return `/questions?${new URLSearchParams({ groups: JSON.stringify(groups), order, mode, state, started: '1' })}`;
}
