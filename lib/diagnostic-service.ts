import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { EXAM_SUBJECTS } from "@/data/exam-chapters";
import { usableAnswer } from "@/lib/question-answer";
import { recordFirstAnswers } from "@/lib/question-stats";
import { DIAGNOSTIC_CONFIG, selectDiagnosticQuestions, summarizeDiagnostic, type Candidate, type DiagnosticView, type DiagnosticKind, type parseDiagnosticAnswer } from "@/lib/diagnostic";
import type { VerificationMetadata } from "@/lib/reinforcement";

export class DiagnosticError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type Item = {
  position: number; question_id: number | null; source_question_id: number; subject: string; chapter: string | null;
  question: string; options: string[]; image: string | null; answer_key: string;
  selected_answer: string | null; is_correct: boolean | null;
};

export async function planMode(client: PoolClient, userId: string, write: boolean, requiredMode: 'coach' | 'custom' = 'coach') {
  const { rows } = await client.query(`SELECT mode FROM study_plans WHERE user_id = $1 ${write ? "FOR UPDATE" : "FOR SHARE"}`, [userId]);
  const mode = rows[0]?.mode ?? null;
  if (write && mode !== requiredMode) throw new DiagnosticError(409, requiredMode === 'custom' ? '請先切換至自訂進度模式。原有計畫已保留。' : "請先選擇國考教練模式，再開始或繼續診斷。");
  return mode;
}

export async function readDiagnostic(client: PoolClient, userId: string, kind: DiagnosticKind = "initial", sessionId: string | null = null): Promise<DiagnosticView> {
  const mode = await planMode(client, userId, false);
  const { rows: sessions } = await client.query("SELECT id, completed_at FROM diagnostic_sessions WHERE user_id = $1 AND kind = $2 AND ($3::uuid IS NULL OR id = $3) ORDER BY created_at DESC, id DESC LIMIT 1", [userId, kind, sessionId]);
  if (!sessions[0]) return { mode, session: null };
  const session = sessions[0];
  const { rows } = await client.query<Item>("SELECT position, source_question_id, subject, chapter, question, options, image, selected_answer, is_correct FROM diagnostic_items WHERE session_id = $1 ORDER BY position", [session.id]);
  const results = summarizeDiagnostic(rows);
  const current = rows.find(row => row.selected_answer === null);
  return { mode, session: {
    id: session.id, total: rows.length, answered: rows.filter(row => row.selected_answer !== null).length,
    completed: Boolean(session.completed_at),
    shortages: kind === "initial" ? results.filter(row => row.total < DIAGNOSTIC_CONFIG.questionsPerSubject).map(row => ({ subject: row.subject, available: row.total })) : [],
    results: session.completed_at ? results : [],
    current: current ? { position: current.position, questionId: current.source_question_id, subject: current.subject, chapter: current.chapter, question: current.question, options: current.options, image: current.image } : null,
  } };
}

export async function startDiagnostic(client: PoolClient, userId: string): Promise<DiagnosticView> {
  // Serialize create, answer and mode-switch operations on the existing plan row.
  await planMode(client, userId, true);
  const existing = await client.query("SELECT id FROM diagnostic_sessions WHERE user_id = $1 AND kind = 'initial'", [userId]);
  if (existing.rows.length) return readDiagnostic(client, userId);
  const candidates = await diagnosticCandidates(client, userId);
  const selected = selectDiagnosticQuestions(candidates);
  if (!selected.length) throw new DiagnosticError(409, "目前尚無可用的診斷題目，請稍後再試。你的學習紀錄已保留。");
  await createDiagnosticSession(client, userId, selected);
  return readDiagnostic(client, userId);
}

export async function diagnosticCandidates(client: PoolClient, userId: string): Promise<Candidate[]> {
  const { rows: candidates } = await client.query<Candidate>(`
    SELECT q.id, q.subject, q.chapter,
      GREATEST(s.created_at, history.last_answered)::text AS last_answered
    FROM questions q JOIN question_sets qs ON qs.id = q.question_set_id
    LEFT JOIN question_answer_stats s ON s.question_id = q.id AND s.user_id = $1
    LEFT JOIN LATERAL (
      SELECT MAX(i.answered_at) AS last_answered FROM diagnostic_items i
      JOIN diagnostic_sessions d ON d.id = i.session_id
      WHERE d.user_id = $1 AND i.source_question_id = q.id
    ) history ON TRUE
    WHERE qs.visibility = 'public' AND q.subject = ANY($2::text[])
      AND NULLIF(BTRIM(q.question), '') IS NOT NULL
      AND UPPER(BTRIM(q.answer)) ~ '^[A-E]$'
      AND NULLIF(BTRIM(CASE UPPER(BTRIM(q.answer)) WHEN 'A' THEN q.option_a WHEN 'B' THEN q.option_b
        WHEN 'C' THEN q.option_c WHEN 'D' THEN q.option_d WHEN 'E' THEN q.option_e END), '') IS NOT NULL
  `, [userId, EXAM_SUBJECTS]);
  return candidates;
}

export async function createDiagnosticSession(client: PoolClient, userId: string, selected: Candidate[], kind: DiagnosticKind = "initial", parentId: string | null = null, verification?: { taskId: string; metadata: VerificationMetadata }) {
  const { rows: source } = await client.query(`SELECT q.id, q.subject, q.chapter, q.question, q.answer, q.image_data_url,
    q.option_a, q.option_b, q.option_c, q.option_d, q.option_e
    FROM questions q JOIN question_sets qs ON qs.id = q.question_set_id
    WHERE q.id = ANY($1::integer[]) AND qs.visibility = 'public' FOR SHARE OF q, qs`, [selected.map(row => row.id)]);
  const snapshots = selected.flatMap(candidate => {
    const row = source.find(row => row.id === candidate.id);
    if (!row) return [];
    if ((kind === "verification" || kind === "follow_up" || kind === "daily" || kind === 'custom') && (row.subject !== candidate.subject || row.chapter !== candidate.chapter)) return [];
    const options = [row.option_a, row.option_b, row.option_c, row.option_d, row.option_e].map(value => value ?? "");
    const answer = usableAnswer({ answer: row.answer, options });
    if (!answer) return [];
    return [{ ...candidate, question: row.question, options, answer, image: row.image_data_url ?? null }];
  });
  if (!snapshots.length) throw new DiagnosticError(409, "題庫正在更新，請重新開始診斷。");
  const id = randomUUID();
  if ((kind === "verification" || kind === "follow_up")) {
    if (!verification) throw new DiagnosticError(400, "缺少補強任務資料。");
    const metadata = { ...verification.metadata, repeated_question_ids: verification.metadata.repeated_question_ids.filter(id => snapshots.some(row => row.id === id)) };
    await client.query("INSERT INTO diagnostic_sessions (id, user_id, kind, parent_session_id, created_at, reinforcement_task_id, verification_metadata) VALUES ($1, $2, $3, $4, clock_timestamp(), $5, $6::jsonb)", [id, userId, kind, parentId, verification.taskId, JSON.stringify(metadata)]);
  } else {
    await client.query("INSERT INTO diagnostic_sessions (id, user_id, kind, parent_session_id, created_at) VALUES ($1, $2, $3, $4, clock_timestamp())", [id, userId, kind, parentId]);
  }
  await client.query(`INSERT INTO diagnostic_items
    (session_id, position, question_id, source_question_id, subject, chapter, question, options, image, answer_key)
    SELECT $1, item.position, item.id, item.id, item.subject, item.chapter, item.question, item.options, item.image, item.answer
    FROM jsonb_to_recordset($2::jsonb) AS item(position integer, id integer, subject text, chapter text, question text, options jsonb, image text, answer text)`,
  [id, JSON.stringify(snapshots.map((row, index) => ({ ...row, position: index + 1 })))]);
  return id;
}

export async function answerDiagnostic(client: PoolClient, userId: string, submission: NonNullable<ReturnType<typeof parseDiagnosticAnswer>>, kind: DiagnosticKind = "initial"): Promise<DiagnosticView> {
  await planMode(client, userId, true, kind === 'custom' ? 'custom' : 'coach');
  const { rows: sessions } = await client.query("SELECT id FROM diagnostic_sessions WHERE user_id = $1 AND id = $2 AND kind = $3 FOR UPDATE", [userId, submission.sessionId, kind]);
  if (!sessions.length) throw new DiagnosticError(404, "找不到你的診斷，請重新載入。");
  const { rows } = await client.query<Item>("SELECT * FROM diagnostic_items WHERE session_id = $1 ORDER BY position", [submission.sessionId]);
  const item = rows.find(row => row.position === submission.position);
  if (!item) throw new DiagnosticError(400, "診斷題目無效。");
  if (item.selected_answer !== null) {
    if (item.selected_answer !== submission.answer) throw new DiagnosticError(409, "本題已儲存其他答案，請重新載入診斷。");
    return readDiagnostic(client, userId, kind, (kind === "verification" || kind === "follow_up" || kind === "daily" || kind === 'custom') ? submission.sessionId : null); // Safe retry after an ambiguous network failure.
  }
  if (rows.find(row => row.selected_answer === null)?.position !== item.position) throw new DiagnosticError(409, "請先完成目前題目，再繼續診斷。");
  if (!item.options[submission.answer.charCodeAt(0) - 65]?.trim()) throw new DiagnosticError(400, "請選擇有效選項。");
  // Existing statistics retain their original first-answer semantics.
  await client.query("LOCK TABLE question_answer_stats IN ROW EXCLUSIVE MODE");
  if (item.question_id !== null) await recordFirstAnswers(async (text, values) => (await client.query(text, values)).rows, userId,
    [{ question_id: item.question_id, selected_answer: submission.answer }]);
  await client.query(`UPDATE diagnostic_items SET selected_answer = $3, is_correct = (answer_key = $3), answered_at = CURRENT_TIMESTAMP
    WHERE session_id = $1 AND position = $2 AND selected_answer IS NULL`, [submission.sessionId, item.position, submission.answer]);
  if (rows.filter(row => row.selected_answer === null).length === 1) {
    await client.query("UPDATE diagnostic_sessions SET completed_at = CURRENT_TIMESTAMP WHERE id = $1 AND completed_at IS NULL", [submission.sessionId]);
  }
  return readDiagnostic(client, userId, kind, (kind === "verification" || kind === "follow_up" || kind === "daily" || kind === 'custom') ? submission.sessionId : null);
}
