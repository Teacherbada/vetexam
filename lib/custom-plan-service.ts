import 'server-only';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { answerDiagnostic, createDiagnosticSession, diagnosticCandidates, DiagnosticError, planMode } from '@/lib/diagnostic-service';
import { customEstimate, inCustomScope, type CustomConfig, type CustomEstimate, type CustomView } from '@/lib/custom-plan';

type Plan = { id: string; config: CustomConfig; status: 'active' | 'paused' | 'completed'; pool_date: string; started: string; completed_at: string | null };
const today = async (client: PoolClient): Promise<string> => (await client.query("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::date::text AS date")).rows[0].date;
async function getPlan(client: PoolClient, userId: string): Promise<Plan | null> {
  return (await client.query("SELECT id,config,status,pool_date::text,(created_at AT TIME ZONE 'Asia/Taipei')::date::text AS started,(completed_at AT TIME ZONE 'Asia/Taipei')::date::text AS completed_at FROM custom_plans WHERE user_id=$1", [userId])).rows[0] ?? null;
}
async function answers(client: PoolClient, planId: string): Promise<{ id: number; correct: boolean }[]> {
  return (await client.query(`SELECT DISTINCT ON(i.source_question_id) i.source_question_id AS id,i.is_correct AS correct FROM custom_daily_tasks t
    JOIN diagnostic_items i ON i.session_id=t.session_id WHERE t.plan_id=$1 AND i.answered_at IS NOT NULL ORDER BY i.source_question_id,i.answered_at DESC`, [planId])).rows;
}
async function refreshPool(client: PoolClient, userId: string, plan: Plan, date: string) {
  const candidates = (await diagnosticCandidates(client, userId)).filter(row => inCustomScope(row, plan.config));
  const completed = new Set((await answers(client, plan.id)).map(row => row.id));
  const old = (await client.query('SELECT source_question_id AS id,subject,chapter FROM custom_plan_questions WHERE plan_id=$1', [plan.id])).rows;
  // Keep completed, subsequently removed questions in the scoped progress denominator.
  const retained = old.filter(row => completed.has(row.id) && inCustomScope(row, plan.config)).map(row => row.id);
  await client.query('UPDATE custom_plan_questions SET in_scope=(source_question_id=ANY($2::int[])) WHERE plan_id=$1', [plan.id, retained]);
  await client.query(`INSERT INTO custom_plan_questions(plan_id,source_question_id,subject,chapter,excluded_prior)
    SELECT $1,id,subject,chapter,last_answered IS NOT NULL FROM jsonb_to_recordset($2::jsonb) AS q(id integer,subject text,chapter text,last_answered text)
    ON CONFLICT(plan_id,source_question_id) DO UPDATE SET subject=EXCLUDED.subject,chapter=EXCLUDED.chapter,in_scope=TRUE,
      excluded_prior=custom_plan_questions.excluded_prior OR EXCLUDED.excluded_prior`, [plan.id, JSON.stringify(candidates)]);
  await client.query('UPDATE custom_plans SET pool_date=$2::date WHERE id=$1', [plan.id, date]);
}
async function estimate(client: PoolClient, plan: Plan, date: string): Promise<CustomEstimate> {
  const done = await answers(client, plan.id), byId = new Map(done.map(row => [row.id, row]));
  const pool = (await client.query('SELECT source_question_id AS id,excluded_prior FROM custom_plan_questions WHERE plan_id=$1 AND in_scope', [plan.id])).rows;
  const eligible = pool.filter(row => byId.has(row.id) || !plan.config.preferUnanswered || !row.excluded_prior);
  const completed = eligible.filter(row => byId.has(row.id)).length;
  return { ...customEstimate(eligible.length - completed, plan.config, date), total: eligible.length, remaining: eligible.length - completed, completed,
    excluded: pool.length - eligible.length, correct: done.filter(row => row.correct).length, answered: done.length };
}
async function updateCompletion(client: PoolClient, plan: Plan, date: string) {
  if (plan.status === 'paused') return;
  const counts = await estimate(client, plan, date);
  await client.query(`UPDATE custom_plans SET status=$2,completed_at=CASE WHEN $2='completed' THEN COALESCE(completed_at,CURRENT_TIMESTAMP) ELSE NULL END WHERE id=$1`,
    [plan.id, counts.total > 0 && counts.remaining === 0 ? 'completed' : 'active']);
}
export async function previewCustomPlan(client: PoolClient, userId: string, config: CustomConfig): Promise<CustomEstimate> {
  await planMode(client, userId, false);
  const date = await today(client), plan = await getPlan(client, userId);
  const done = plan ? await answers(client, plan.id) : [], byId = new Map(done.map(row => [row.id, row]));
  const pool = (await diagnosticCandidates(client, userId)).filter(row => inCustomScope(row, config));
  const eligible = pool.filter(row => byId.has(row.id) || !config.preferUnanswered || !row.last_answered);
  const completed = eligible.filter(row => byId.has(row.id)).length;
  return { ...customEstimate(eligible.length - completed, config, date), total: eligible.length, remaining: eligible.length - completed, completed,
    excluded: pool.length - eligible.length, correct: done.filter(row => row.correct).length, answered: done.length };
}
export async function readCustomPlan(client: PoolClient, userId: string): Promise<CustomView> {
  const mode = await planMode(client, userId, false), date = await today(client), plan = await getPlan(client, userId);
  const base = { mode, owner: userId, date, plan: null, task: null, history: [], receipts: [] };
  if (!plan) return base;
  const summary = await estimate(client, plan, date);
  const task = (await client.query('SELECT id,session_id,target_count FROM custom_daily_tasks WHERE user_id=$1 AND plan_id=$2 AND local_date=$3::date', [userId, plan.id, date])).rows[0];
  const history = (await client.query(`SELECT t.local_date::text AS date,COUNT(*)::int AS total,COUNT(i.answered_at)::int AS answered
    FROM custom_daily_tasks t JOIN diagnostic_items i ON i.session_id=t.session_id WHERE t.plan_id=$1 GROUP BY t.id ORDER BY t.local_date DESC LIMIT 14`, [plan.id])).rows;
  const result = { ...base, history, plan: { id: plan.id, config: plan.config, status: plan.status, started: plan.started, completedAt: plan.completed_at, estimate: summary } };
  if (!task) return result;
  const rows = (await client.query(`SELECT i.*,COALESCE(q.explanation,'') AS explanation FROM diagnostic_items i
    LEFT JOIN questions q ON q.id=i.question_id AND EXISTS(SELECT 1 FROM question_sets qs WHERE qs.id=q.question_set_id AND qs.visibility='public') WHERE i.session_id=$1 ORDER BY i.position`, [task.session_id])).rows;
  const current = rows.find(row => row.selected_answer === null), completed = rows.length > 0 && !current;
  const receipts = rows.filter(row => row.selected_answer !== null).map(row => ({ eventId: `${task.session_id}:${row.position}`, id: row.source_question_id,
    subject: row.subject, question: row.question, options: row.options, image: row.image, answer: row.answer_key, explanation: row.explanation, userAnswer: row.selected_answer, correct: row.is_correct === true }));
  return { ...result, receipts, task: { id: task.id, total: rows.length, target: task.target_count, answered: receipts.length, completed,
    correct: completed ? receipts.filter(row => row.correct).length : null,
    current: current ? { position: current.position, question: current.question, options: current.options, image: current.image } : null } };
}
export async function saveCustomPlan(client: PoolClient, userId: string, config: CustomConfig) {
  await planMode(client, userId, true, 'custom');
  const date = await today(client);
  await client.query(`INSERT INTO custom_plans(id,user_id,config,pool_date) VALUES($1,$2,$3::jsonb,$4::date)
    ON CONFLICT(user_id) DO UPDATE SET config=EXCLUDED.config,updated_at=CURRENT_TIMESTAMP`, [randomUUID(), userId, JSON.stringify(config), date]);
  const plan = (await getPlan(client, userId))!;
  await refreshPool(client, userId, plan, date); await updateCompletion(client, plan, date);
  return readCustomPlan(client, userId);
}
export async function setCustomPaused(client: PoolClient, userId: string, paused: boolean) {
  await planMode(client, userId, true, 'custom');
  await client.query("UPDATE custom_plans SET status=$2,updated_at=CURRENT_TIMESTAMP WHERE user_id=$1", [userId, paused ? 'paused' : 'active']);
  return readCustomPlan(client, userId);
}
export async function startCustomDay(client: PoolClient, userId: string) {
  await planMode(client, userId, true, 'custom');
  const plan = await getPlan(client, userId), date = await today(client);
  if (!plan || plan.status === 'paused') return readCustomPlan(client, userId);
  if (plan.pool_date !== date) await refreshPool(client, userId, plan, date);
  await updateCompletion(client, plan, date);
  const existing = await client.query('SELECT id FROM custom_daily_tasks WHERE user_id=$1 AND plan_id=$2 AND local_date=$3::date', [userId, plan.id, date]);
  if (existing.rows.length) return readCustomPlan(client, userId);
  const counts = await estimate(client, plan, date);
  if (!counts.remaining) return readCustomPlan(client, userId);
  const done = new Set((await answers(client, plan.id)).map(row => row.id));
  const ids = new Set((await client.query('SELECT source_question_id AS id FROM custom_plan_questions WHERE plan_id=$1 AND in_scope AND (NOT $2 OR NOT excluded_prior)', [plan.id, plan.config.preferUnanswered])).rows.map(row => row.id));
  const selected = (await diagnosticCandidates(client, userId)).filter(row => ids.has(row.id) && !done.has(row.id) && inCustomScope(row, plan.config))
    .sort((a, b) => Number(Boolean(a.last_answered)) - Number(Boolean(b.last_answered)) || a.id - b.id).slice(0, counts.target);
  if (!selected.length) return readCustomPlan(client, userId);
  const sessionId = await createDiagnosticSession(client, userId, selected, 'custom');
  await client.query('INSERT INTO custom_daily_tasks(id,user_id,plan_id,local_date,target_count,config,session_id) VALUES($1,$2,$3,$4::date,$5,$6::jsonb,$7)',
    [randomUUID(), userId, plan.id, date, counts.target, JSON.stringify(plan.config), sessionId]);
  return readCustomPlan(client, userId);
}
export async function answerCustomDay(client: PoolClient, userId: string, submission: { taskId: string; position: number; answer: string }) {
  await planMode(client, userId, true, 'custom');
  const plan = await getPlan(client, userId), date = await today(client);
  const task = (await client.query('SELECT session_id,local_date::text FROM custom_daily_tasks WHERE id=$1 AND user_id=$2 FOR UPDATE', [submission.taskId, userId])).rows[0];
  if (!task || !plan) throw new DiagnosticError(404, '找不到你的今日進度。');
  if (plan.status === 'paused') throw new DiagnosticError(409, '計畫已暫停，請先恢復計畫。');
  if (task.local_date !== date) throw new DiagnosticError(409, '已進入新的一天，請重新載入今日進度。過去紀錄已保留。');
  await answerDiagnostic(client, userId, { sessionId: task.session_id, position: submission.position, answer: submission.answer }, 'custom');
  await updateCompletion(client, plan, date);
  return readCustomPlan(client, userId);
}
