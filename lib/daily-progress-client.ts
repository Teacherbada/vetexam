import { saveProgress } from '../data/progress';
import { saveWrongQuestion } from '../data/wrongAnswers';
import { addDailyProgress } from '../data/tasksProgress';
import type { DailyView } from './daily-task';

// Bridge confirmed server answers into the existing browser-only review/progress stores.
// Session/item IDs deduplicate refreshes and answers shared with the standalone follow-up.
export function syncDailyProgress(view: Pick<DailyView, 'owner' | 'receipts'>) {
  const key=`coachDailySynced:${view.owner}`;
  const raw: unknown=JSON.parse(localStorage.getItem(key)||'[]');
  const seen=new Set<string>(Array.isArray(raw)?raw.filter(item=>typeof item==='string'):[]);
  for(const row of view.receipts) {
    if(seen.has(row.eventId)) continue;
    saveProgress(row.id,row.correct,row.subject);
    if(!row.correct) saveWrongQuestion(row,row.userAnswer);
    addDailyProgress();
    seen.add(row.eventId);
    localStorage.setItem(key,JSON.stringify([...seen].slice(-2000)));
  }
}
