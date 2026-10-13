import { EXAM_SUBJECTS, validChapter } from '@/data/exam-chapters';

export const AI_METHOD = '依管理員提供資料由 AI 生成，再由管理員審核';
export const AI_NOTICE = '本題庫由網站自動生成題目，供觀念練習與自我測驗使用，非歷屆國考題。';
export type AISource = { title: string; edition: string; chapter: string; printedPages: string; pdfPages: string; excerpt: string; url: string };
export type AIQuestionInput = { subject: string; chapter: string; question: string; options: string[]; answer: string; explanation: string; optionExplanations: string[]; source: AISource; generationMethod: string };
export type AIPreviewRow = { index: number; question: AIQuestionInput | null; errors: string[]; warnings: string[] };
export type AIPreview = { rows: AIPreviewRow[]; valid: number; invalid: number; token?: string };
export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function parseAIQuestion(value: unknown, index = 1): AIPreviewRow {
  const errors: string[] = [], warnings: string[] = [];
  if (!isRecord(value)) return { index, question: null, errors: ['題目必須是 JSON 物件'], warnings };
  const field = (obj: Record<string, unknown>, key: string, label: string, required = true, max = 12000) => {
    const raw = obj[key];
    if (raw != null && typeof raw !== 'string') errors.push(label + '必須是文字');
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (required && !text) errors.push('缺少' + label);
    if (text.length > max) errors.push(label + '過長');
    return text;
  };
  const subject = field(value, 'subject', '科目'), chapter = field(value, 'chapter', '官方章節');
  if (!EXAM_SUBJECTS.includes(subject)) errors.push('科目不屬於官方分類');
  if (!chapter || !validChapter(subject, chapter)) errors.push('章節不屬於該科目的官方分類');
  const question = field(value, 'question', '題幹');
  const options = Array.isArray(value.options) ? value.options.map((v: unknown) => typeof v === 'string' ? v.trim() : '') : [];
  if (options.length !== 4 || options.some(v => !v || v.length > 6000)) errors.push('必須提供四個非空白文字選項（每項最多 6000 字）');
  if (new Set(options.map(v => v.normalize('NFKC').toLowerCase())).size !== options.length) errors.push('選項不可重複');
  const answer = field(value, 'answer', '唯一答案').toUpperCase();
  if (!/^[A-D]$/.test(answer)) errors.push('答案必須是唯一的 A、B、C 或 D');
  const explanation = field(value, 'explanation', '完整解析');
  const optionExplanations = value.optionExplanations == null ? ['', '', '', ''] : value.optionExplanations;
  if (!Array.isArray(optionExplanations) || optionExplanations.length !== 4 || optionExplanations.some(v => typeof v !== 'string' || v.length > 6000)) errors.push('各選項解析須為四個文字欄位，可留空');
  const sourceValue = isRecord(value.source) ? value.source : {};
  const source: AISource = {
    title: field(sourceValue, 'title', '來源書名／講義名', true, 500),
    edition: field(sourceValue, 'edition', '版本', false, 200),
    chapter: field(sourceValue, 'chapter', '來源章節', false, 500),
    printedPages: field(sourceValue, 'printedPages', '書本印刷頁碼', false, 100),
    pdfPages: field(sourceValue, 'pdfPages', 'PDF 頁次', false, 100),
    excerpt: field(sourceValue, 'excerpt', '支持答案的簡短來源摘錄', true, 2000),
    url: field(sourceValue, 'url', '公開來源連結', false, 2000),
  };
  if (!source.chapter && !source.printedPages && !source.pdfPages) errors.push('來源定位不足：請至少提供來源章節、印刷頁碼或 PDF 頁次');
  for (const [key, label] of [['edition','版本'],['chapter','來源章節'],['printedPages','印刷頁碼'],['pdfPages','PDF 頁次']] as const) if (!source[key]) warnings.push(label + '未提供／未確認');
  if (source.url) { try { const url = new URL(source.url); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); } catch { errors.push('來源連結須為不含帳密的 HTTPS 網址'); } }
  const generationMethod = field(value, 'generationMethod', '出題方式說明');
  if (generationMethod !== AI_METHOD) errors.push('出題方式請使用範例中的固定說明');
  // Never accept import-supplied publication/review flags or quietly discard fields.
  const allowed = ['subject','chapter','question','options','answer','explanation','optionExplanations','source','generationMethod'];
  if (Object.keys(value).some(k => !allowed.includes(k))) errors.push('含不支援欄位（不可匯入年份、圖片或發布／審核狀態）');
  if (Object.keys(sourceValue).some(k => !Object.hasOwn(source, k))) errors.push('來源含不支援欄位');
  return { index, errors, warnings, question: { subject, chapter, question, options, answer, explanation, optionExplanations: Array.isArray(optionExplanations) ? optionExplanations.map(v => typeof v === 'string' ? v.trim() : '') : [], source, generationMethod } };
}
export function parseAIBatch(input: unknown) {
  if (!isRecord(input) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200) throw new Error('請提供批次名稱（最多 200 字）');
  if (Object.keys(input).some(k => !['name','questions'].includes(k))) throw new Error('批次只支援 name 與 questions');
  if (!Array.isArray(input.questions) || !input.questions.length || input.questions.length > 200) throw new Error('每批須為 1–200 題');
  return { name: input.name.trim(), rows: input.questions.map((q, i) => parseAIQuestion(q, i + 1)) };
}
