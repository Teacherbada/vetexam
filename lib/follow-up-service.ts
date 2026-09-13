import 'server-only';
import type { PoolClient } from 'pg';
import { answerDiagnostic, createDiagnosticSession, diagnosticCandidates, DiagnosticError, planMode, readDiagnostic } from '@/lib/diagnostic-service';
import type { parseDiagnosticAnswer } from '@/lib/diagnostic';
import { selectFollowUpQuestions, type FollowUp, type FollowUpView } from '@/lib/follow-up';
import { dueFollowUps, scheduleFollowUp } from '@/lib/follow-up-store';
import { FOLLOW_UP_MIN_QUESTIONS, FOLLOW_UP_PASS_THRESHOLD } from '@/lib/follow-up-config';

async function activeReinforcement(client: PoolClient, userId: string) {
  const { rows } = await client.query("SELECT id FROM reinforcement_tasks WHERE user_id=$1 AND status IN ('reviewing','reviewed','verifying','needs_work','deferred') LIMIT 1", [userId]);
  return rows.length > 0;
}
export async function readFollowUp(client: PoolClient, userId: string, id: string | null = null): Promise<FollowUpView> {
  const mode = await planMode(client, userId, false);
  const { rows } = await client.query<FollowUp>(`SELECT *, CASE WHEN status='pending' AND due_at <= CURRENT_TIMESTAMP THEN 'due' ELSE status END AS status
    FROM chapter_follow_ups WHERE user_id=$1 ORDER BY created_at DESC,id DESC`, [userId]);
  const due = await dueFollowUps(client, userId);
  const followUp = id ? rows.find(row => row.id === id) ?? null : due[0] ?? rows.find(row => row.status === 'pending') ?? rows[0] ?? null;
  if (id && !followUp) throw new DiagnosticError(404, '找不到你的複習追蹤。');
  const session = followUp?.session_id ? (await readDiagnostic(client, userId, 'follow_up', followUp.session_id)).session : null;
  return { mode, followUp, session, history: rows, activeReinforcement: await activeReinforcement(client, userId) };
}
async function ownedFollowUp(client: PoolClient, userId: string, id: string) {
  await planMode(client, userId, true);
  const { rows } = await client.query<FollowUp & { is_due: boolean }>('SELECT *, due_at <= CURRENT_TIMESTAMP AS is_due FROM chapter_follow_ups WHERE user_id=$1 AND id=$2 FOR UPDATE', [userId, id]);
  if (!rows[0]) throw new DiagnosticError(404, '找不到你的複習追蹤。');
  return rows[0];
}
export async function startFollowUp(client: PoolClient, userId: string, id: string) {
  const followUp = await ownedFollowUp(client, userId, id);
  if (followUp.session_id) return readFollowUp(client, userId, id);
  if (followUp.status !== 'pending' || !followUp.is_due) throw new DiagnosticError(409, '這項追蹤尚未到期或已結束。');
  if (await activeReinforcement(client, userId)) throw new DiagnosticError(409, '請先繼續目前的補強任務，再進行到期追蹤。');
  if ((await dueFollowUps(client, userId))[0]?.id !== id) throw new DiagnosticError(409, '請先完成目前推薦的追蹤，再開始下一項。');
  const { rows: tasks } = await client.query('SELECT source_session_id, review_completed_at FROM reinforcement_tasks WHERE id=$1 AND user_id=$2 AND review_count=$3 AND status=\'short_term\'', [followUp.reinforcement_task_id, userId, followUp.review_attempt]);
  if (!tasks[0]) throw new DiagnosticError(409, '章節補強狀態已更新，請重新載入。');
  const candidates = await diagnosticCandidates(client, userId);
  const { rows: history } = await client.query(`SELECT i.source_question_id AS id, COUNT(*)::int AS appearances,
    MAX(COALESCE(i.answered_at,d.created_at))::text AS last_seen,
    BOOL_OR(d.reinforcement_task_id=$2 AND d.kind IN ('verification','follow_up')) AS previous
    FROM diagnostic_items i JOIN diagnostic_sessions d ON d.id=i.session_id WHERE d.user_id=$1 GROUP BY i.source_question_id`, [userId, followUp.reinforcement_task_id]);
  const selected = selectFollowUpQuestions(candidates.map(row => {
    const old = history.find(item => item.id === row.id);
    const lastSeen = [old?.last_seen, row.last_answered].filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
    return { ...row, appearances: old?.appearances ?? 0, last_seen: lastSeen, previous: old?.previous ?? false };
  }), followUp.subject, followUp.chapter);
  if (!selected.length) throw new DiagnosticError(409, '此章節目前沒有可用追蹤題目，任務會保留，請稍後再試。');
  const sessionId = await createDiagnosticSession(client, userId, selected, 'follow_up', tasks[0].source_session_id, {
    taskId: followUp.reinforcement_task_id, metadata: { review_attempt: followUp.review_attempt,
      reviewed_at: new Date(tasks[0].review_completed_at).toISOString(), repeated_question_ids: selected.filter(row => row.last_seen || row.last_answered).map(row => row.id),
      pass_threshold: FOLLOW_UP_PASS_THRESHOLD, min_questions: FOLLOW_UP_MIN_QUESTIONS },
  });
  await client.query('UPDATE chapter_follow_ups SET session_id=$2 WHERE id=$1', [id, sessionId]);
  return readFollowUp(client, userId, id);
}
export async function answerFollowUp(client: PoolClient, userId: string, id: string, submission: NonNullable<ReturnType<typeof parseDiagnosticAnswer>>) {
  const followUp = await ownedFollowUp(client, userId, id);
  if (followUp.session_id !== submission.sessionId) throw new DiagnosticError(404, '這不是此追蹤的測驗。');
  if (followUp.status === 'cancelled') throw new DiagnosticError(409, '這項追蹤已取消。');
  const view = await answerDiagnostic(client, userId, submission, 'follow_up');
  if (view.session?.completed && followUp.status === 'pending') {
    const { rows } = await client.query('SELECT verification_metadata, completed_at FROM diagnostic_sessions WHERE id=$1', [submission.sessionId]);
    const metadata = rows[0].verification_metadata;
    const correct = view.session.results.reduce((sum, row) => sum + row.correct, 0);
    const total = view.session.total;
    const sufficient = total >= metadata.min_questions;
    const passed = sufficient && correct / total >= metadata.pass_threshold;
    const result = { correct, total, passed, sufficient, reused: metadata.repeated_question_ids.length };
    await client.query('UPDATE chapter_follow_ups SET status=$2,completed_at=$3,result=$4::jsonb WHERE id=$1', [id, passed ? 'completed' : 'failed', rows[0].completed_at, JSON.stringify(result)]);
    if (passed && followUp.stage < followUp.intervals.length) {
      await scheduleFollowUp(client, followUp.reinforcement_task_id, followUp.stage + 1, followUp.intervals, new Date(rows[0].completed_at).toISOString());
    } else {
      await client.query("UPDATE reinforcement_tasks SET status=$2 WHERE id=$1 AND review_count=$3 AND status='short_term'", [followUp.reinforcement_task_id, passed ? 'stable' : 'queued', followUp.review_attempt]);
      if (!passed) await client.query("UPDATE chapter_follow_ups SET status='cancelled' WHERE reinforcement_task_id=$1 AND review_attempt=$2 AND status='pending'", [followUp.reinforcement_task_id, followUp.review_attempt]);
    }
  }
  return readFollowUp(client, userId, id);
}
