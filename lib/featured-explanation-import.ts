import 'server-only';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { QuestionAdminError, checkPreviewToken, issuePreviewToken } from './admin-questions';
import { validId, normalizeAnswer } from './admin-question-input';
import { parseExplanation } from './official-explanation';
import { serializeAnswer, answerKeys } from './question-answer';
import { IMPORT_FILE_BYTES, type ExplanationImportItem, type ExplanationImportRow, type ImportSelection, type ImportResult, type ImportOutcome } from './featured-explanation-import-input';

type Row = Record<string, unknown>;
type Query = (text: string, values: unknown[]) => Promise<Row[]>;
type Entry = { item?: ExplanationImportItem; row: ExplanationImportRow };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const selection = `SELECT q.id,q.question_set_id,q.question,q.option_a,q.option_b,q.option_c,q.option_d,q.option_e,
 q.answer,q.subject,q.question_number,q.image_data_url,q.explanation,q.explanation_status,q.explanation_version::text,
 qs.exam_year,qs.name FROM questions q JOIN question_sets qs ON qs.id=q.question_set_id
 WHERE q.id=ANY($1::int[]) AND q.kind='exam' AND qs.visibility='public' ORDER BY q.id`;

/** Versioned, exact (no text normalization) fingerprint, independent of explanation edits. */
export function questionFingerprint(q: Row) {
  return hash(['vetexam-exam-question-v1', Number(q.id), Number(q.question_set_id), q.question ?? '',
    q.option_a ?? '', q.option_b ?? '', q.option_c ?? '', q.option_d ?? '', q.option_e ?? '',
    q.answer ?? '', q.subject ?? '', q.question_number ?? null, q.image_data_url ?? '', q.exam_year ?? null]);
}
const previewFingerprint = (entry: Entry, q: Row) => hash(['featured-explanation-import-v1', entry.row.index, entry.item, q]);

export function parseImport(input: unknown): Entry[] {
  if (!object(input) || Object.keys(input).some(key => key !== 'explanations') || !Array.isArray(input.explanations)) {
    throw new QuestionAdminError('請提供 { "explanations": [...] } JSON，勿加入其他欄位');
  }
  if (!input.explanations.length || input.explanations.length > 50) throw new QuestionAdminError('每批須為 1–50 筆解析');
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > IMPORT_FILE_BYTES) throw new QuestionAdminError('JSON 檔案最多 2 MiB', 413);
  const counts = new Map<number, number>();
  for (const value of input.explanations) if (object(value) && validId(value.questionId)) counts.set(value.questionId, (counts.get(value.questionId) ?? 0) + 1);
  return input.explanations.map((value, index) => {
    const row: ExplanationImportRow = { index, questionId: object(value) && validId(value.questionId) ? value.questionId : null,
      expectedAnswer: object(value) ? serializeAnswer(value.expectedAnswer, true) ?? '' : '',
      answer: '', summary: '', explanation: object(value) && typeof value.explanation === 'string' ? value.explanation.slice(0, 20000) : '', category: 'invalid', reason: '' };
    try {
      if (!object(value) || Object.keys(value).some(key => !['questionId', 'expectedAnswer', 'explanation', 'questionFingerprint', 'sourceReferences'].includes(key))) throw new QuestionAdminError('欄位不合法；僅接受規格中的解析欄位');
      if (!validId(value.questionId)) throw new QuestionAdminError('questionId 必須是有效整數 ID');
      if ((counts.get(value.questionId) ?? 0) > 1) throw new QuestionAdminError('同一檔案含重複 questionId，所有重複項目均拒絕');
      if (typeof value.expectedAnswer === 'string' ? !/^[A-E]$/.test(value.expectedAnswer) : !Array.isArray(value.expectedAnswer) || !serializeAnswer(value.expectedAnswer)) throw new QuestionAdminError('expectedAnswer 必須是合法答案或答案陣列');
      if (value.questionFingerprint !== undefined && (typeof value.questionFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.questionFingerprint))) throw new QuestionAdminError('questionFingerprint 必須為 64 位小寫 SHA-256');
      parseExplanation({ id: value.questionId, explanation: value.explanation, revision: '0'.repeat(64), action: 'draft' });
      let explanation = value.explanation;
      if (value.sourceReferences !== undefined) {
        if (!Array.isArray(value.sourceReferences) || value.sourceReferences.length > 10) throw new QuestionAdminError('sourceReferences 最多 10 個網址');
        for (const link of value.sourceReferences) {
          if (typeof link !== 'string' || link.length > 2048 || !/^https?:\/\//i.test(link) || /[\s<>\\\u0000-\u001f\u007f]/.test(link)) throw new QuestionAdminError('參考資料僅接受有效 HTTP／HTTPS 網址');
          try { const url = new URL(link); if (!url.hostname || url.username || url.password) throw Error(); }
          catch { throw new QuestionAdminError('參考資料網址無效'); }
        }
        if (typeof explanation === 'string' && value.sourceReferences.length) explanation += '\n\n### 參考資料\n' + value.sourceReferences.map(link => `- <${link}>`).join('\n');
      }
      // Reuse Phase 1 content rules, including combined content/reference length.
      parseExplanation({ id: value.questionId, explanation, revision: '0'.repeat(64), action: 'draft' });
      const item = { ...value, explanation } as ExplanationImportItem;
      return { item, row: { ...row, explanation: item.explanation, category: 'ready' as const } };
    } catch (error) {
      if (!(error instanceof QuestionAdminError)) throw error;
      return { row: { ...row, reason: error.message } };
    }
  });
}

function assess(entry: Entry, q?: Row): ExplanationImportRow {
  const row = { ...entry.row };
  if (q) { row.summary = String(q.question ?? '').slice(0, 240); row.answer = normalizeAnswer(q.answer as string | null); }
  if (!entry.item) return row;
  if (!q) return { ...row, category: 'not_found', reason: '找不到可匯入的公開國考題目（不存在或非此題庫）' };
  row.summary = String(q.question ?? '').slice(0, 240);
  row.answer = normalizeAnswer(q.answer as string | null);
  row.questionFingerprint = questionFingerprint(q);
  if (row.answer !== serializeAnswer(entry.item.expectedAnswer, true)) return { ...row, category: 'answer_mismatch', reason: 'expectedAnswer 與題庫完整正確答案集合不一致' };
  if (!answerKeys(row.answer).every(letter => String(q['option_' + letter.toLowerCase()] ?? '').trim())) return { ...row, category: 'invalid', reason: '正確答案對應選項為空，請先人工核對題目' };
  if (entry.item.questionFingerprint && entry.item.questionFingerprint !== row.questionFingerprint) return { ...row, category: 'invalid', reason: '題目指紋不一致，禁止匯入' };
  if ((q.explanation !== null && q.explanation !== '') || q.explanation_status === 'published') {
    const status = q.explanation_status === 'published' ? 'published' : 'draft';
    return { ...row, category: 'existing', status, reason: status === 'published' ? '已有已發布解析，批次匯入禁止覆蓋' : '已有草稿，請使用單題編輯；批次匯入不覆蓋' };
  }
  return row;
}
export async function previewImport(query: Query, entries: Entry[], userId: string) {
  const ids = entries.flatMap(entry => entry.row.questionId ? [entry.row.questionId] : []);
  const questions = await query(selection, [ids]);
  const byId = new Map(questions.map(q => [Number(q.id), q]));
  return { rows: entries.map(entry => {
    const q = byId.get(entry.row.questionId!);
    const row = assess(entry, q);
    return row.category === 'ready' && q ? { ...row, token: issuePreviewToken(previewFingerprint(entry, q), userId) } : row;
  }) };
}
export function parseSelections(value: unknown, entries: Entry[]): ImportSelection[] {
  if (!Array.isArray(value) || !value.length || value.length > entries.length) throw new QuestionAdminError('請勾選 1–50 筆解析');
  const indices = new Set<number>();
  return value.map(item => {
    if (!object(item) || Object.keys(item).some(key => !['index', 'token'].includes(key)) || !Number.isInteger(item.index) || (item.index as number) < 0 || (item.index as number) >= entries.length || typeof item.token !== 'string' || item.token.length > 2048 || indices.has(item.index as number)) throw new QuestionAdminError('勾選資料無效或重複');
    indices.add(item.index as number);
    return { index: item.index as number, token: item.token };
  });
}

/** Caller owns transaction. Row locks, not table locks; one read and one bulk UPDATE. */
export async function applyImport(client: Pick<PoolClient, 'query'>, entries: Entry[], selected: ImportSelection[], userId: string): Promise<ImportResult> {
  const tokens = new Map(selected.map(item => [item.index, item.token]));
  const ids = entries.filter(entry => tokens.has(entry.row.index) && entry.item).map(entry => entry.item!.questionId);
  const { rows: questions } = await client.query(selection + ' FOR UPDATE OF q FOR SHARE OF qs', [ids]);
  const byId = new Map(questions.map(q => [Number(q.id), q]));
  const writes: { id: number; explanation: string }[] = [];
  const rows: ImportOutcome[] = entries.map(entry => {
    const base = { index: entry.row.index, questionId: entry.row.questionId };
    if (!tokens.has(entry.row.index)) return { ...base, status: 'skipped', reason: '未勾選' };
    const q = byId.get(entry.row.questionId!);
    const current = assess(entry, q);
    if (current.category !== 'ready') return { ...base, status: current.category === 'existing' ? 'skipped' : 'failed', reason: current.reason };
    if (!q || !checkPreviewToken(tokens.get(entry.row.index), previewFingerprint(entry, q), userId)) return { ...base, status: 'failed', reason: '預覽已過期、題目已變更或匯入內容已變更，請重新預覽' };
    writes.push({ id: entry.item!.questionId, explanation: entry.item!.explanation });
    return { ...base, status: 'success', reason: '已儲存草稿，尚未發布' };
  });
  if (writes.length) {
    const result = await client.query(`UPDATE questions q SET explanation=v.explanation,explanation_status='draft',explanation_version=q.explanation_version+1
      FROM jsonb_to_recordset($1::jsonb) AS v(id integer,explanation text),question_sets qs
      WHERE q.id=v.id AND qs.id=q.question_set_id AND q.kind='exam' AND qs.visibility='public'
      AND (q.explanation IS NULL OR q.explanation='') AND q.explanation_status='draft' RETURNING q.id`, [JSON.stringify(writes)]);
    if (result.rows.length !== writes.length) throw new QuestionAdminError('寫入條件已變更，本次寫入已全部回復；請重新預覽', 409);
  }
  return { rows, success: rows.filter(r => r.status === 'success').length, failed: rows.filter(r => r.status === 'failed').length, skipped: rows.filter(r => r.status === 'skipped').length };
}
