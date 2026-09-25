import type { History } from './learning-client';
import type { FrequencyRow } from './chapter-frequency';
export function learningPriorities(history: History[], frequency: FrequencyRow[]) {
  const latest = new Map<number, History>();
  for (const row of history) {
    const previous = latest.get(row.question_id);
    if (!previous || Date.parse(row.answered_at) > Date.parse(previous.answered_at)) latest.set(row.question_id,row);
  }
  return frequency.flatMap(row => {
    const answers = [...latest.values()].filter(answer => answer.subject === row.subject && answer.chapter === row.chapter);
    if (answers.length < 10 || !row.count || !row.papers) return [];
    const accuracy = answers.filter(answer => answer.is_correct).length / answers.length;
    if (accuracy >= .8) return [];
    const counts = frequency.filter(other => other.subject === row.subject && other.count > 0).map(other => other.count).sort((a,b) => a-b);
    const high = row.count >= counts[counts.length - Math.ceil(counts.length / 3)];
    return [{ ...row, accuracy, answered: answers.length, high, priority: (1 - accuracy) * row.share }];
  }).sort((a,b) => b.priority-a.priority || b.answered-a.answered || a.subject.localeCompare(b.subject) || a.chapter.localeCompare(b.chapter)).slice(0,6);
}
