import "server-only";
import type { PoolClient } from "pg";
import { answerDiagnostic, createDiagnosticSession, diagnosticCandidates, DiagnosticError, planMode, readDiagnostic } from "@/lib/diagnostic-service";
import { type parseDiagnosticAnswer } from "@/lib/diagnostic";
import { buildWeaknessAnalysis, confirmationTargets, selectConfirmationQuestions, type ConfirmationView, type Evidence } from "@/lib/weakness";

async function evidence(client: PoolClient, userId: string): Promise<Evidence[]> {
  const { rows } = await client.query<Evidence>(`
    SELECT i.source_question_id AS question_id, i.subject, i.chapter, i.is_correct, i.answered_at::text, CASE WHEN d.kind='daily' THEN 'first' ELSE d.kind END AS kind
    FROM diagnostic_items i JOIN diagnostic_sessions d ON d.id = i.session_id
    WHERE d.user_id = $1 AND d.kind IN ('initial', 'confirmation', 'daily') AND i.answered_at IS NOT NULL
      AND (d.completed_at IS NOT NULL OR d.kind='daily')
    UNION ALL
    SELECT s.question_id, q.subject, q.chapter, s.is_correct, s.created_at::text AS answered_at, 'first' AS kind
    FROM question_answer_stats s JOIN questions q ON q.id = s.question_id
    JOIN question_sets qs ON qs.id = q.question_set_id
    WHERE s.user_id = $1 AND qs.visibility = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM diagnostic_items i JOIN diagnostic_sessions d ON d.id = i.session_id
        WHERE d.user_id = $1 AND i.source_question_id = s.question_id AND i.answered_at IS NOT NULL
          AND (d.kind IN ('initial', 'confirmation') OR i.answered_at <= s.created_at)
      )
  `, [userId]);
  return rows;
}

export async function readWeaknessAnalysis(client: PoolClient, userId: string) {
  return buildWeaknessAnalysis(await evidence(client, userId));
}

export async function readConfirmation(client: PoolClient, userId: string): Promise<ConfirmationView> {
  const initial = await readDiagnostic(client, userId);
  const view = await readDiagnostic(client, userId, "confirmation");
  const analysis = await readWeaknessAnalysis(client, userId);
  const targets = initial.session ? confirmationTargets(initial.session) : [];
  const selected = targets.length ? selectConfirmationQuestions(await diagnosticCandidates(client, userId), targets, analysis) : [];
  return { ...view, initialCompleted: initial.session?.completed === true, targets,
    available: targets.map(subject => ({ subject, count: selected.filter(row => row.subject === subject).length })), analysis };
}

export async function startConfirmation(client: PoolClient, userId: string): Promise<ConfirmationView> {
  await planMode(client, userId, true);
  const initial = await readDiagnostic(client, userId);
  if (!initial.session?.completed) throw new DiagnosticError(409, "請先完成初始診斷，再進行弱點確認。");
  const latest = await readDiagnostic(client, userId, "confirmation");
  if (latest.session && !latest.session.completed) return readConfirmation(client, userId);
  const targets = confirmationTargets(initial.session);
  if (!targets.length) throw new DiagnosticError(409, "目前沒有需要優先確認的科目，可以先繼續一般練習。");
  const analysis = await readWeaknessAnalysis(client, userId);
  const selected = selectConfirmationQuestions(await diagnosticCandidates(client, userId), targets, analysis);
  if (!selected.length) throw new DiagnosticError(409, "目前沒有足夠的不同題目可供確認，請待題庫補充或間隔一段時間後再試。既有結果已保留。");
  await createDiagnosticSession(client, userId, selected, "confirmation", initial.session.id);
  return readConfirmation(client, userId);
}

export async function answerConfirmation(client: PoolClient, userId: string, submission: NonNullable<ReturnType<typeof parseDiagnosticAnswer>>): Promise<ConfirmationView> {
  await answerDiagnostic(client, userId, submission, "confirmation");
  return readConfirmation(client, userId);
}
