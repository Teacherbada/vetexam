export type Review = { id: number; subject: string; question: string; options: string[]; answer: string; explanation: string; note?: string; userAnswer?: string };
export type History = { question_id: number; subject: string; chapter: string | null; is_correct: boolean; answered_at: string; mode: string };
export type Learning = { owner: string | null; progress: Record<string, { answered: number[]; correct: number; wrong: number }>; favorites: Review[]; wrongQuestions: Review[]; history: History[]; legacy: Record<string, unknown>[] };
let owner: string | null = null;
let snapshot: Learning | null = null;
let status = 'loading';
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
export const subscribeLearning = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getLearning = () => snapshot;
export const getLearningStatus = () => status;
export const learningOwner = () => owner;
export function localValue<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; } }
export function reviewItems(key: 'favorites' | 'wrongQuestions'): Review[] { return owner ? snapshot?.[key] ?? [] : localValue(key, []); }

async function post(body: Record<string, unknown>) {
  const res = await fetch('/api/learning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('sync failed');
}
let generation = 0;
export async function setLearningOwner(next: string | null) {
  owner = next; snapshot = null; status = 'loading'; const token = ++generation; notify();
  if (!next) { status = 'guest'; notify(); return; }
  try {
    // An unscoped browser archive is claimed by exactly one account on this device.
    let claimed = localStorage.getItem('learningLegacyOwner');
    if (!claimed) { localStorage.setItem('learningLegacyOwner', next); claimed = next; }
    if (claimed === next && !localStorage.getItem(`learningMigrated:${next}`)) {
      let deviceId = localStorage.getItem('learningDeviceId');
      if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem('learningDeviceId', deviceId); }
      const payload = Object.fromEntries(['progress','wrongQuestions','favorites','dailyProgress'].map(key => [key, localValue(key, key === 'favorites' || key === 'wrongQuestions' ? [] : {})]));
      await post({ action: 'import', owner: next, deviceId, payload });
      localStorage.setItem(`learningMigrated:${next}`, '1');
    }
  } catch { /* Keep every original key and allow practice even when import fails. */ }
  if (token !== generation) return;
  await flushLearning(next);
  await refreshLearning(token);
}
export async function refreshLearning(token = generation) {
  if (!owner) return;
  try {
    const res = await fetch('/api/learning', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error('unavailable');
    const data = await res.json();
    if (token !== generation || data.owner !== owner) return;
    snapshot = data; status = 'ready'; notify();
  } catch { if (token === generation) { status = 'error'; notify(); } }
}
type Command = Record<string, unknown> & { owner: string; commandId: string };
let flushing = false;
export async function flushLearning(forOwner = owner) {
  if (!forOwner || flushing) return;
  flushing = true;
  const key = `learningOutbox:${forOwner}`;
  try {
    while (localValue<Command[]>(key, []).length) {
      const command = localValue<Command[]>(key, [])[0];
      if (owner !== forOwner) break;
      await post(command);
      localStorage.setItem(key, JSON.stringify(localValue<Command[]>(key, []).filter(c => c.commandId !== command.commandId)));
    }
  } catch { status = 'error'; notify(); }
  finally { flushing = false; }
}
export function enqueueLearning(command: Record<string, unknown>) {
  if (!owner) return;
  const key = `learningOutbox:${owner}`;
  try { localStorage.setItem(key, JSON.stringify([...localValue<Command[]>(key, []), { ...command, owner, commandId: crypto.randomUUID() }])); }
  catch { status = 'error'; notify(); return; }
  void flushLearning().then(() => refreshLearning());
}
export function recordLearning(answers: { question_id: number; selected_answer: string }[], mode: 'practice' | 'exam' = 'practice') {
  for (let offset = 0; offset < answers.length; offset += 100) enqueueLearning({ action: 'answers', mode, answers: answers.slice(offset, offset + 100).map(answer => ({ ...answer, event_id: crypto.randomUUID(), answered_at: new Date().toISOString() })) });
}
export function optimisticFavorites(favorites: Review[]) { if (snapshot) { snapshot = { ...snapshot, favorites }; notify(); } }
export function updateReview(questionId: number, field: 'favorite' | 'wrong' | 'note', value: boolean | string) {
  if (snapshot && field === 'favorite' && value === false) snapshot = { ...snapshot, favorites: snapshot.favorites.filter(q => q.id !== questionId) };
  enqueueLearning({ action: 'review', questionId, field, value });
}
