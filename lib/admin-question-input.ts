export type AnswerEntry = { question_number: number; answer: string };
export type AnswerInput = {
  question_set_id: number;
  mode: 'keyboard' | 'table' | 'sequence' | 'single';
  text?: string;
  answers?: AnswerEntry[];
  question_id?: number;
  answer?: string;
};
export type AdminQuestion = {
  id: number; question_set_id: number; question_number: number; subject: string;
  question: string; option_a: string; option_b: string; option_c: string; option_d: string;
  option_e: string | null; answer: string | null; explanation: string;
  exam_year?: number | null; question_set_name?: string;
};
export const normalizeAnswer = (value: string | null | undefined) => (value ?? '').trim().toUpperCase();
export const validId = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
export function needsManualReview(question: AdminQuestion) {
  return Boolean(question.option_e?.trim()) ||
    Boolean(normalizeAnswer(question.answer) && !/^[A-D]$/.test(normalizeAnswer(question.answer))) ||
    [question.option_a, question.option_b, question.option_c, question.option_d].some(value => !value?.trim());
}
export function parseInput(value: unknown): AnswerInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('答案資料格式錯誤');
  const input = value as Record<string, unknown>;
  if (!validId(input.question_set_id)) throw new Error('請先選擇特定題庫');
  if (Object.keys(input).some(key => !['question_set_id', 'mode', 'text', 'answers', 'question_id', 'answer'].includes(key))) throw new Error('不支援的答案欄位');
  if (!['keyboard', 'table', 'sequence', 'single'].includes(String(input.mode))) throw new Error('請選擇輸入模式');
  if (input.mode === 'single') {
    if (!validId(input.question_id) || typeof input.answer !== 'string' || !/^[A-D]$/.test(normalizeAnswer(input.answer))) throw new Error('單題答案僅允許 A/B/C/D');
    return { question_set_id: input.question_set_id, mode: 'single', question_id: input.question_id, answer: normalizeAnswer(input.answer) };
  }
  if (input.mode === 'keyboard') {
    if (!Array.isArray(input.answers) || !input.answers.length || input.answers.length > 1000) throw new Error('請輸入 1–1000 題答案');
    const seen = new Set<number>();
    const answers = input.answers.map(row => {
      if (!row || typeof row !== 'object' || Object.keys(row).some(key => !['question_number', 'answer'].includes(key)) || !validId(row.question_number) || typeof row.answer !== 'string' || !/^[A-D]$/.test(normalizeAnswer(row.answer))) throw new Error('題號或答案無效，答案僅允許 A/B/C/D');
      if (seen.has(row.question_number)) throw new Error(`重複題號：${row.question_number}`);
      seen.add(row.question_number);
      return { question_number: row.question_number, answer: normalizeAnswer(row.answer) };
    });
    return { question_set_id: input.question_set_id, mode: 'keyboard', answers };
  }
  if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 20000) throw new Error('請貼上答案（最多 20,000 字元）');
  return { question_set_id: input.question_set_id, mode: input.mode as 'table' | 'sequence', text: input.text };
}
export function parseEntries(input: AnswerInput, questions: AdminQuestion[]) {
  const errors: string[] = [];
  let entries: AnswerEntry[] = [];
  if (input.mode === 'single') {
    const question = questions.find(q => q.id === input.question_id);
    if (!question) errors.push('找不到此題目，或題目不屬於所選題庫');
    else entries = [{ question_number: question.question_number, answer: input.answer! }];
  } else if (input.mode === 'keyboard') entries = input.answers!;
  else if (input.mode === 'sequence') {
    const text = input.text!.replace(/\s/g, '').toUpperCase();
    if (!/^[A-D]+$/.test(text)) errors.push('連續答案僅允許 A/B/C/D 與空白');
    if (text.length !== questions.length) errors.push(`答案數量與題目數量不一致：預期 ${questions.length} 題，輸入 ${text.length} 個答案。請確認是否漏掉某題。`);
    if (questions.some((q, i) => q.question_number !== i + 1)) errors.push('題號有缺號或重複，禁止使用連續字串');
    if (!errors.length) entries = [...text].map((answer, i) => ({ question_number: i + 1, answer }));
  } else {
    const seen = new Set<number>();
    input.text!.split(/\r?\n/).forEach((line, index) => {
      if (!line.trim()) return;
      const match = /^\s*(\d+)(?:\s*[.、:]\s*|\s+)([A-D])\s*$/i.exec(line);
      if (!match || !validId(Number(match[1]))) { errors.push(`第 ${index + 1} 行無法解析（格式：1 A）`); return; }
      const number = Number(match[1]);
      if (seen.has(number)) { errors.push(`第 ${index + 1} 行題號 ${number} 重複`); return; }
      seen.add(number); entries.push({ question_number: number, answer: match[2].toUpperCase() });
    });
  }
  if (entries.length > 1000) errors.push('每次最多 1000 題');
  return { entries, errors };
}
