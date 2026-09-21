import { chapterGroups, validChapter } from '../data/exam-chapters';

export const CHAPTER_CONFIDENCE_THRESHOLD = 0.90;
export const CLASSIFICATION_BATCH_SIZE = 20;
export const CLASSIFICATION_MAX_CHARS = 24000;
export type ClassificationQuestion = { question: string; options: string[]; answer: string; explanation: string };
export type ChapterSuggestion = { suggestedChapter: string | null; confidence: number; secondChoice: string | null; reason: string };
export type ChapterReview = ChapterSuggestion & { chapter: string | null; reviewed: boolean };
export type ClassificationMode = 'ai' | 'same' | 'later';

export function unclassified(reason = '分類失敗，可人工選擇章節或稍後處理。'): ChapterSuggestion {
  return { suggestedChapter: null, confidence: 0, secondChoice: null, reason };
}

// Unlike validChapter (which accepts empty values for legacy callers), model output must be exact.
export function validateSuggestion(subject: string, value: unknown): ChapterSuggestion {
  if (!value || typeof value !== 'object') return unclassified();
  const row = value as Record<string, unknown>;
  const allowed = chapterGroups(subject).flatMap(group => group.chapters);
  if (!(row.suggestedChapter === null || (typeof row.suggestedChapter === 'string' && allowed.includes(row.suggestedChapter))) ||
    !(row.secondChoice === null || (typeof row.secondChoice === 'string' && allowed.includes(row.secondChoice))) ||
    typeof row.confidence !== 'number' || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1 ||
    typeof row.reason !== 'string' || !row.reason.trim() || row.reason.length > 600 ||
    (row.secondChoice !== null && row.secondChoice === row.suggestedChapter)) return unclassified();
  return { suggestedChapter: row.suggestedChapter as string | null, confidence: row.suggestedChapter === null ? 0 : row.confidence,
    secondChoice: row.secondChoice as string | null, reason: row.reason };
}

export function toReview(suggestion: ChapterSuggestion): ChapterReview {
  return { ...suggestion, chapter: suggestion.confidence >= CHAPTER_CONFIDENCE_THRESHOLD ? suggestion.suggestedChapter : null, reviewed: false };
}
export function needsReview(row: ChapterReview) {
  return !!row.suggestedChapter && row.confidence < CHAPTER_CONFIDENCE_THRESHOLD && !row.reviewed;
}

export function classificationInput(question: ClassificationQuestion) {
  return { question: question.question, option_a: question.options[0] || '', option_b: question.options[1] || '',
    option_c: question.options[2] || '', option_d: question.options[3] || '', option_e: question.options[4] || '',
    answer: question.answer, explanation: question.explanation };
}

export function classificationBatches(questions: ClassificationQuestion[]): number[][] {
  const batches: number[][] = [];
  let current: number[] = [], chars = 0;
  questions.forEach((question, index) => {
    const size = JSON.stringify(classificationInput(question)).length;
    // Oversized items are left unclassified; never truncate the evidence for the model.
    if (size > CLASSIFICATION_MAX_CHARS) return;
    if (current.length >= CLASSIFICATION_BATCH_SIZE || chars + size > CLASSIFICATION_MAX_CHARS) {
      batches.push(current); current = []; chars = 0;
    }
    current.push(index); chars += size;
  });
  if (current.length) batches.push(current);
  return batches;
}

export function validImportChapters(subject: string, questions: { chapter?: unknown }[]) {
  return questions.every(question => question && validChapter(subject, question.chapter));
}
