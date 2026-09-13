import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { answerDiagnostic, createDiagnosticSession, diagnosticCandidates, DiagnosticError, planMode, readDiagnostic } from "@/lib/diagnostic-service";
import { readWeaknessAnalysis } from "@/lib/confirmation-service";
import type { parseDiagnosticAnswer } from "@/lib/diagnostic";
import { dueFollowUps, scheduleFollowUp } from '@/lib/follow-up-store';
import { nextReinforcement, reinforcementPassed, selectVerificationQuestions, REINFORCEMENT_MIN_VERIFICATION_QUESTIONS, REINFORCEMENT_PASS_THRESHOLD, REINFORCEMENT_RECENT_DAYS, type ReinforcementCommand, type ReinforcementTask, type ReinforcementView, type VerificationMetadata, type VerificationAttempt } from "@/lib/reinforcement";

async function attempts(client: PoolClient, userId: string, taskId: string): Promise<VerificationAttempt[]> {
  const { rows } = await client.query(`SELECT d.id, d.verification_metadata AS metadata, d.completed_at,
    COUNT(i.position)::int AS total, COUNT(i.answered_at)::int AS answered,
    COUNT(*) FILTER (WHERE i.is_correct)::int AS correct
    FROM diagnostic_sessions d JOIN diagnostic_items i ON i.session_id = d.id
    WHERE d.user_id = $1 AND d.reinforcement_task_id = $2 AND d.kind = 'verification'
    GROUP BY d.id ORDER BY (d.verification_metadata->>'review_attempt')::int`, [userId, taskId]);
  return rows.map(row => ({ id: row.id, attempt: row.metadata.review_attempt, reviewedAt: row.metadata.reviewed_at,
    total: row.total, answered: row.answered, correct: row.completed_at ? row.correct : 0,
    completedAt: row.completed_at, repeatedCount: row.metadata.repeated_question_ids.length,
    passThreshold: row.metadata.pass_threshold, minQuestions: row.metadata.min_questions }));
}

export async function readReinforcement(client: PoolClient, userId: string): Promise<ReinforcementView> {
  const mode = await planMode(client, userId, false);
  const { rows } = await client.query<ReinforcementTask>(`SELECT id, subject, chapter, status, source_analysis, source_session_id,
    review_count, created_at, started_at, review_completed_at, verification_completed_at
    FROM reinforcement_tasks WHERE user_id = $1 ORDER BY (status NOT IN ('short_term','stable','queued')) DESC, (status = 'queued') DESC, created_at DESC, id DESC`, [userId]);
  const task = rows[0] ?? null;
  const completed: ReinforcementView['completed'] = [];
  for (const row of rows.filter(row => ['short_term','stable'].includes(row.status))) {
    const history = await attempts(client, userId, row.id);
    const last = history.at(-1);
    if (last) completed.push({ subject: row.subject, chapter: row.chapter, baseline: row.source_analysis.accuracy, correct: last.correct, total: last.total, status: row.status });
  }
  const history = task ? await attempts(client, userId, task.id) : [];
  const current = history.find(row => row.attempt === task?.review_count);
  const session = current ? (await readDiagnostic(client, userId, 'verification', current.id)).session : null;
  const next = await readWeaknessAnalysis(client, userId).then(analysis => nextReinforcement(analysis, completed));
  return { mode, task, next: task && !['short_term','stable'].includes(task.status) ? null : next, session, attempts: history, completed, due: await dueFollowUps(client, userId) };
}

export async function startReinforcement(client: PoolClient, userId: string) {
  await planMode(client, userId, true);
  const view = await readReinforcement(client, userId);
  if (view.task && !['short_term','stable','queued'].includes(view.task.status)) return view;
  if (view.due.length) throw new DiagnosticError(409, '請先完成已到期的複習追蹤，再開始下一個補強任務。');
  if (view.task?.status === 'queued') {
    await client.query("UPDATE reinforcement_tasks SET status='reviewing', review_count=review_count+1, review_completed_at=NULL, verification_completed_at=NULL WHERE id=$1", [view.task.id]);
    return readReinforcement(client, userId);
  }
  const initial = await readDiagnostic(client, userId);
  if (!initial.session?.completed) throw new DiagnosticError(409, '請先完成初始診斷與弱點確認。');
  if (!view.next?.chapter) throw new DiagnosticError(409, '目前沒有足夠證據推薦新的章節補強，請先繼續弱點確認或一般練習。');
  await client.query(`INSERT INTO reinforcement_tasks (id,user_id,subject,chapter,source_session_id,source_analysis,status,created_at,started_at)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,'reviewing',clock_timestamp(),clock_timestamp())`,
  [randomUUID(), userId, view.next.subject, view.next.chapter, initial.session.id, JSON.stringify(view.next)]);
  return readReinforcement(client, userId);
}

async function ownedTask(client: PoolClient, userId: string, taskId: string) {
  await planMode(client, userId, true);
  const { rows } = await client.query<ReinforcementTask & { paused_status: ReinforcementTask['status'] | null }>(
    'SELECT * FROM reinforcement_tasks WHERE id = $1 AND user_id = $2 FOR UPDATE', [taskId, userId]);
  if (!rows[0]) throw new DiagnosticError(404, '找不到你的補強任務。');
  return rows[0];
}

export async function changeReinforcement(client: PoolClient, userId: string, command: ReinforcementCommand) {
  const task = await ownedTask(client, userId, command.taskId);
  if (command.reviewAttempt !== task.review_count) throw new DiagnosticError(409, '複習進度已更新，請重新載入。');
  const reject = () => { throw new DiagnosticError(409, '任務狀態已更新，請重新載入後依下一步繼續。'); };
  switch (command.action) {
    case 'review':
      if (task.status === 'reviewing') await client.query("UPDATE reinforcement_tasks SET status = 'reviewed', review_completed_at = clock_timestamp() WHERE id = $1", [task.id]);
      else if (!['reviewed', 'verifying', 'short_term', 'needs_work'].includes(task.status)) reject();
      break;
    case 'again':
      if (task.status !== 'needs_work') reject();
      await client.query("UPDATE reinforcement_tasks SET status = 'reviewing', review_count = review_count + 1, review_completed_at = NULL, verification_completed_at = NULL WHERE id = $1", [task.id]);
      break;
    case 'defer':
      if (['short_term','stable','queued'].includes(task.status)) reject();
      if (task.status !== 'deferred') await client.query("UPDATE reinforcement_tasks SET paused_status = status, status = 'deferred' WHERE id = $1", [task.id]);
      break;
    case 'resume':
      if (task.status === 'deferred') await client.query('UPDATE reinforcement_tasks SET status = paused_status, paused_status = NULL WHERE id = $1', [task.id]);
      break;
    case 'verify': {
      if (task.status === 'verifying' || task.status === 'short_term') break;
      if (task.status !== 'reviewed' || !task.review_completed_at) reject();
      const candidates = await diagnosticCandidates(client, userId);
      const { rows } = await client.query(`SELECT DISTINCT i.source_question_id AS id FROM diagnostic_items i
        JOIN diagnostic_sessions d ON d.id = i.session_id WHERE d.user_id = $1
        AND (d.reinforcement_task_id = $2 OR COALESCE(i.answered_at, d.created_at) >= CURRENT_TIMESTAMP - ($3 * interval '1 day'))
        UNION SELECT question_id AS id FROM question_answer_stats WHERE user_id = $1 AND created_at >= CURRENT_TIMESTAMP - ($3 * interval '1 day')`, [userId, task.id, REINFORCEMENT_RECENT_DAYS]);
      const excluded = new Set<number>(rows.map(row => row.id));
      const selected = selectVerificationQuestions(candidates, task.subject, task.chapter, excluded);
      if (!selected.length) throw new DiagnosticError(409, '這個章節目前沒有可用的確認題目。複習進度已保留，請待題庫補充後再試。');
      const metadata: VerificationMetadata = { review_attempt: task.review_count, reviewed_at: new Date(task.review_completed_at!).toISOString(),
        repeated_question_ids: selected.filter(row => row.last_answered || excluded.has(row.id)).map(row => row.id),
        pass_threshold: REINFORCEMENT_PASS_THRESHOLD, min_questions: REINFORCEMENT_MIN_VERIFICATION_QUESTIONS };
      await createDiagnosticSession(client, userId, selected, 'verification', task.source_session_id, { taskId: task.id, metadata });
      await client.query("UPDATE reinforcement_tasks SET status = 'verifying' WHERE id = $1", [task.id]);
      break;
    }
  }
  return readReinforcement(client, userId);
}

export async function answerReinforcement(client: PoolClient, userId: string, taskId: string, submission: NonNullable<ReturnType<typeof parseDiagnosticAnswer>>) {
  const task = await ownedTask(client, userId, taskId);
  const { rows } = await client.query(`SELECT verification_metadata FROM diagnostic_sessions
    WHERE id = $1 AND user_id = $2 AND reinforcement_task_id = $3 AND kind = 'verification'`, [submission.sessionId, userId, task.id]);
  const metadata: VerificationMetadata | undefined = rows[0]?.verification_metadata;
  if (!metadata) throw new DiagnosticError(404, '找不到這個任務的確認測驗。');
  if (metadata.review_attempt !== task.review_count || !['verifying', 'short_term', 'needs_work'].includes(task.status)) throw new DiagnosticError(409, '請回到目前的補強進度繼續。');
  const view = await answerDiagnostic(client, userId, submission, 'verification');
  if (view.session?.completed && task.status === 'verifying') {
    const correct = view.session.results.reduce((sum, row) => sum + row.correct, 0);
    const status = reinforcementPassed(correct, view.session.total, metadata.pass_threshold, metadata.min_questions) ? 'short_term' : 'needs_work';
    await client.query('UPDATE reinforcement_tasks SET status = $2, verification_completed_at = clock_timestamp() WHERE id = $1', [task.id, status]);
    if (status === 'short_term') await scheduleFollowUp(client, task.id);
  }
  return readReinforcement(client, userId);
}
