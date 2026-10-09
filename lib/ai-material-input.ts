import { EXAM_SUBJECTS, validChapter } from '@/data/exam-chapters';
import { isRecord, uuid, AI_METHOD, parseAIQuestion, type AIQuestionInput } from './ai-question-input';

export const MATERIAL_LIMITS = { model: 'gpt-4.1-mini-2025-04-14', maxFileBytes: 3 * 1024 * 1024, maxPages: 100, maxQuestions: 10, maxSourceBytes: 18000, maxInputTokens: 32000, maxOutputTokens: 2400, retries: 0, perQuestionMicroUSD: 16640, batchMicroUSD: 200000, dailyMicroUSD: 2000000 } as const;
export type MaterialPage = { page: number; text: string; hash: string; usable: boolean; visual: boolean; warning: string };
export type MaterialSpec = { materialId: string; title: string; edition: string; subject: string; chapter: string; sourceChapter: string; start: number; end: number; count: number; difficulty: string; printedPages: Record<string,string> };
export function parseMaterialSpec(value: unknown, pages: MaterialPage[]): MaterialSpec {
  if (!isRecord(value) || !uuid(value.materialId)) throw new Error('教材識別碼無效');
  const text = (key: string, max: number, required = false) => {
    const v = value[key]; if (typeof v !== 'string' || v.length > max || (required && !v.trim())) throw new Error('請填寫有效的 ' + key);
    return v.trim();
  };
  const title = text('title',200,true), edition = text('edition',200), subject = text('subject',100,true), chapter = text('chapter',200,true), sourceChapter = text('sourceChapter',500);
  if (!EXAM_SUBJECTS.includes(subject) || !validChapter(subject,chapter)) throw new Error('請使用既有科目與章節');
  const start = value.start as number, end = value.end as number, count = value.count as number;
  if (![start,end,count].every(Number.isSafeInteger) || start < 1 || end < start || end > pages.length || count < 1 || count > 10) throw new Error('頁次範圍無效或題數超過 10 題');
  if (!['基礎','中等','進階'].includes(String(value.difficulty))) throw new Error('難度無效');
  const selected = pages.filter(p => p.page >= start && p.page <= end);
  if (selected.length !== end-start+1 || selected.some(p => !p.usable)) throw new Error('選取範圍有空白、掃描或文字品質不足頁面，請先 OCR 或人工處理');
  if (new TextEncoder().encode(selected.map(p => p.text).join('\n')).length > MATERIAL_LIMITS.maxSourceBytes) throw new Error('本批文字超過 18 KB，請縮小頁次範圍');
  if (!isRecord(value.printedPages)) throw new Error('印刷頁碼對照無效');
  const printedPages: Record<string,string> = {};
  for (const p of selected) { const v = value.printedPages[String(p.page)] ?? ''; if (typeof v !== 'string' || v.length > 30) throw new Error('印刷頁碼過長'); printedPages[String(p.page)] = v.trim(); }
  return { materialId:value.materialId,title,edition,subject,chapter,sourceChapter,start,end,count,difficulty:String(value.difficulty),printedPages };
}
export const normalizeExcerpt = (s: string) => s.normalize('NFKC').replace(/\s+/g,' ').trim();
export function generatedQuestion(value: unknown, spec: MaterialSpec, pages: MaterialPage[]): { question: AIQuestionInput; page: number; pageHash: string } {
  if (!isRecord(value) || value.status !== 'generated') throw new Error('教材不足，無法生成有來源支持的題目');
  const page = pages.find(p => p.page === value.pdfPage && p.page >= spec.start && p.page <= spec.end);
  if (!page || !page.usable || typeof value.excerpt !== 'string' || value.excerpt.trim().length < 12 || value.excerpt.length > 1000 || !normalizeExcerpt(page.text).includes(normalizeExcerpt(value.excerpt))) throw new Error('來源摘錄或 PDF 頁次無法在擷取內容中驗證');
  const parsed = parseAIQuestion({ subject:spec.subject,chapter:spec.chapter,question:value.question,options:value.options,answer:value.answer,explanation:value.explanation,optionExplanations:value.optionExplanations,
    source:{title:spec.title,edition:spec.edition,chapter:spec.sourceChapter,printedPages:spec.printedPages[String(page.page)] || '',pdfPages:String(page.page),excerpt:value.excerpt,url:''},generationMethod:AI_METHOD });
  if (parsed.errors.length) throw new Error(parsed.errors.join('；'));
  return { question:parsed.question!,page:page.page,pageHash:page.hash };
}
