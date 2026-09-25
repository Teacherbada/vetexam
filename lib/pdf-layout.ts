/** PDF coordinates are viewport points, with a top-left origin (rotation included). */
export type PdfLine = { text: string; x: number; top: number; bottom: number };
export type PdfRegion = { id: string; page: number; x: number; y: number; width: number; height: number; source: 'raster' | 'drawing' | 'rendered'; ambiguous?: boolean };
export type PdfPage = { page: number; width: number; height: number; lines: PdfLine[]; images: PdfRegion[]; warning?: string };
export type PdfQuestion = {
  id: number; questionNumber: number; subject: string; question: string; options: string[];
  answer: string | null; explanation: string; pageNumber: number; endPage: number;
  top: number; bottom: number; regions: PdfRegion[]; hasImage: boolean;
  confidence: number; warnings: string[]; rawText: string;
};
export const QUESTION_START = /^\s*(?:[（(](\d{1,3})[）)]|([1-9]\d{0,2})\s*[.、．:：)])\s*(.*)$/;
const OPTION = /(?:^|\s)(?:[（(]([A-EＡ-Ｅ])[）)]|([A-EＡ-Ｅ])\s*[.、．:：)])\s*/g;
const label = (value: string) => String.fromCharCode(value.charCodeAt(0) > 127 ? value.charCodeAt(0) - 0xfee0 : value.charCodeAt(0));

export function stripMargins(pages: PdfPage[]): PdfPage[] {
  const repeats = new Map<string, Set<number>>();
  const key = (line: PdfLine, page: PdfPage) => `${Math.round(line.top / page.height * 50)}:${line.text.trim()}`;
  for (const page of pages) for (const line of page.lines) {
    if (line.top > page.height * .12 && line.bottom < page.height * .88) continue;
    const k = key(line, page); const seen = repeats.get(k) ?? new Set<number>(); seen.add(page.page); repeats.set(k, seen);
  }
  return pages.map(page => ({ ...page, lines: page.lines.filter(line => {
    const margin = line.top < page.height * .12 || line.bottom > page.height * .88;
    if (!margin) return true;
    if (/^(?:第\s*)?\d+\s*(?:頁|\/\s*\d+)?$/.test(line.text.trim()) || /^第\s*\d+\s*頁\s*(?:[，,／/]?\s*共\s*\d+\s*頁)?$/.test(line.text.trim())) return false;
    return (repeats.get(key(line, page))?.size ?? 0) < Math.max(2, Math.ceil(pages.length * .5));
  }) }));
}

export function assessQuestion(q: Pick<PdfQuestion, 'questionNumber' | 'question' | 'options' | 'answer' | 'warnings'>) {
  let score = 100; const warnings = [...new Set(q.warnings)];
  const penalize = (code: string, points: number) => { if (!warnings.includes(code)) warnings.push(code); score -= points; };
  if (!Number.isInteger(q.questionNumber) || q.questionNumber < 1 || q.questionNumber > 999) penalize('題號不合法', 25);
  if (q.question.trim().length < 2 || q.question.length > 6000) penalize('題幹長度異常', 30);
  if (q.options.length < 4 || q.options.length > 5 || q.options.some(o => !o.trim())) penalize('缺選項', 25);
  if (!q.answer) penalize('沒答案', 20);
  else if (!/^[A-E]$/.test(q.answer) || !q.options[q.answer.charCodeAt(0) - 65]?.trim()) penalize('答案不在選項內', 25);
  for (const [code, points] of [['題號不連續', 10], ['選項順序異常', 15], ['圖片不確定', 20], ['parser 警告', 30], ['跨頁', 5]] as const) if (warnings.includes(code)) score -= points;
  return { confidence: Math.max(0, score), warnings };
}

export function parsePdfLayout(input: PdfPage[]): PdfQuestion[] {
  const pages = stripMargins(input);
  const questions: PdfQuestion[] = [];
  let current: PdfQuestion | undefined;
  const bodies = new Map<number, string[]>();
  for (const page of pages) {
    if (page.warning && current) current.warnings.push('parser 警告');
    for (const line of page.lines) {
      const match = line.text.match(QUESTION_START);
      if (match) {
        const number = Number(match[1] ?? match[2]);
        current = { id: questions.length + 1, questionNumber: number, subject: 'PDF 題庫', question: '', options: [], answer: null, explanation: '', pageNumber: page.page, endPage: page.page, top: line.top, bottom: line.bottom, regions: [], hasImage: false, confidence: 0, warnings: [], rawText: '' };
        if (number !== (questions.at(-1)?.questionNumber ?? 0) + 1) current.warnings.push('題號不連續');
        if (page.warning) current.warnings.push('parser 警告');
        questions.push(current); bodies.set(current.id, [match[3]]);
      } else if (current) bodies.get(current.id)!.push(line.text);
      if (current) { current.endPage = page.page; current.bottom = line.bottom; }
    }
  }
  for (const q of questions) {
    q.rawText = bodies.get(q.id)!.join('\n');
    let content = q.rawText;
    const answers = [...content.matchAll(/^\s*(?:答案|正確答案|Answer)\s*[:：]\s*([A-EＡ-Ｅ])\s*$/gim)];
    if (answers.length === 1) q.answer = label(answers[0][1].toUpperCase());
    else if (answers.length > 1) q.warnings.push('parser 警告');
    content = content.replace(/^\s*(?:答案|正確答案|Answer)\s*[:：].*$/gim, '');
    const matches = [...content.matchAll(OPTION)].filter(m => !/^[A-EＡ-Ｅ]\s*圖/.test(content.slice((m.index ?? 0) + m[0].length)));
    q.question = content.slice(0, matches[0]?.index ?? content.length).trim();
    const order: string[] = [];
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i]; const letter = label(m[1] ?? m[2]); const index = letter.charCodeAt(0) - 65;
      if (q.options[index] !== undefined) q.warnings.push('選項順序異常');
      q.options[index] = [q.options[index], content.slice((m.index ?? 0) + m[0].length, matches[i + 1]?.index ?? content.length).trim()].filter(Boolean).join('\n');
      order.push(letter);
    }
    if (order.join('') !== 'ABCD' && order.join('') !== 'ABCDE') q.warnings.push('選項順序異常');
    q.options = Array.from({ length: Math.max(4, q.options.length) }, (_, i) => q.options[i] ?? '');
    if (q.endPage > q.pageNumber) q.warnings.push('跨頁');
  }
  // Index each question's span once; images never attach to every question on a page.
  const spans = new Map<number, { q: PdfQuestion; top: number; bottom: number }[]>();
  questions.forEach((q, i) => {
    const next = questions[i + 1]; const end = next?.pageNumber ?? pages.at(-1)?.page ?? q.endPage;
    for (let p = q.pageNumber; p <= end; p++) {
      const list = spans.get(p) ?? [];
      list.push({ q, top: p === q.pageNumber ? q.top : 0, bottom: p === next?.pageNumber ? next.top : Infinity }); spans.set(p, list);
    }
  });
  for (const page of pages) for (const image of page.images) {
    const center = image.y + image.height / 2;
    const candidates = spans.get(page.page) ?? [];
    let owner = candidates.find(s => center >= s.top && center < s.bottom);
    let ambiguous = image.source !== 'raster';
    if (!owner) { owner = candidates.find(s => s.top > center && s.top - (image.y + image.height) < 120); ambiguous = true; }
    if (!owner) continue;
    const next = candidates.find(s => s.top >= image.y + image.height && s.q !== owner!.q);
    if (image.y < owner.top || image.y + image.height > owner.bottom || (next && next.top - (image.y + image.height) < 24)) ambiguous = true;
    owner.q.regions.push({ ...image, ambiguous });
    owner.q.hasImage = true;
    if (page.page > owner.q.endPage) { owner.q.endPage = page.page; owner.q.bottom = image.y + image.height; owner.q.warnings.push('跨頁'); }
    if (ambiguous) owner.q.warnings.push('圖片不確定');
  }
  for (const q of questions) {
    if (/附圖|如圖|下圖|見圖|照片|影像|figure/i.test(q.question) && !q.regions.length) q.warnings.push('圖片不確定');
    Object.assign(q, assessQuestion(q));
  }
  return questions;
}
