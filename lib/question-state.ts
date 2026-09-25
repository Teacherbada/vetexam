export const QUESTION_STATES = ['all','unanswered','wrong','favorites'] as const;
export type QuestionState = typeof QUESTION_STATES[number];
export function stateSelection(state: QuestionState, data: { answered: number[]; wrong: number[]; favorites: number[] }) {
  if (state === 'all') return null;
  return { ids: [...new Set(state === 'unanswered' ? data.answered : data[state])], exclude: state === 'unanswered' };
}
export function legacyAnsweredIds(archives: Record<string, unknown>[]) {
  const ids = new Set<number>();
  for (const archive of archives) {
    if (!archive.progress || typeof archive.progress !== 'object' || Array.isArray(archive.progress)) continue;
    for (const value of Object.values(archive.progress)) {
      if (!value || typeof value !== 'object' || !('answered' in value) || !Array.isArray(value.answered)) continue;
      for (const id of value.answered) if (Number.isInteger(id) && id > 0 && id <= 2147483647) ids.add(id);
    }
  }
  return [...ids];
}
