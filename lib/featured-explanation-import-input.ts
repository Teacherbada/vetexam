/** Public JSON contract. No client-supplied status, ownership or answer changes. */
export const IMPORT_FILE_BYTES = 2 * 1024 * 1024;
export type ExplanationImportItem = {
  questionId: number;
  expectedAnswer: 'A' | 'B' | 'C' | 'D' | 'E' | ('A' | 'B' | 'C' | 'D' | 'E')[];
  explanation: string;
  questionFingerprint?: string;
  sourceReferences?: string[];
};
export type ExplanationImportFile = { explanations: ExplanationImportItem[] };
export type ImportCategory = 'ready' | 'existing' | 'answer_mismatch' | 'not_found' | 'invalid';
export const importLabels: Record<ImportCategory, string> = {
  ready: '可匯入', existing: '已有解析', answer_mismatch: '答案不一致', not_found: '題目不存在', invalid: '資料格式異常',
};
export type ExplanationImportRow = {
  index: number; questionId: number | null; expectedAnswer: string; answer: string;
  summary: string; explanation: string; category: ImportCategory; reason: string;
  status?: 'draft' | 'published'; questionFingerprint?: string; token?: string;
};
export type ImportSelection = { index: number; token: string };
export type ImportOutcome = { index: number; questionId: number | null; status: 'success' | 'failed' | 'skipped'; reason: string };
export type ImportResult = { rows: ImportOutcome[]; success: number; failed: number; skipped: number };
