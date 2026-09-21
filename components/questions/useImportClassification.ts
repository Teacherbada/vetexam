'use client';

import { useEffect, useRef, useState } from 'react';
import { chapterGroups } from '@/data/exam-chapters';
import { classificationBatches, classificationInput, needsReview, toReview, unclassified, validateSuggestion,
  type ChapterReview, type ClassificationMode, type ClassificationQuestion } from '@/lib/chapter-classification';

export function useImportClassification<T extends ClassificationQuestion>(subject: string, questions: T[]) {
  const [mode, setMode] = useState<ClassificationMode>('ai');
  const [sameChapter, setSameChapter] = useState('');
  const [result, setResult] = useState<{ signature: string; rows: ChapterReview[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  // Image extraction does not invalidate text classification. Text/order/subject changes do.
  const signature = JSON.stringify([subject, questions.map(classificationInput)]);
  useEffect(() => () => controller.current?.abort(), [signature, mode]);
  const rows = result?.signature === signature ? result.rows : null;
  const allowed = chapterGroups(subject).flatMap(group => group.chapters);
  const selectedChapter = allowed.includes(sameChapter) ? sameChapter : '';
  const pending = rows?.filter(needsReview).length ?? 0;
  const ready = !busy && (mode === 'later' || (mode === 'same' ? !!selectedChapter : !!rows && !pending));

  async function classify() {
    if (running.current || !questions.length || !allowed.length) return;
    const abort = new AbortController(); controller.current = abort;
    running.current = true; setBusy(true);
    const next = questions.map(() => toReview(unclassified('尚未取得分類結果，可人工選擇章節或稍後處理。')));
    const batches = classificationBatches(questions);
    try {
      for (let i = 0; i < batches.length; i++) {
        if (abort.signal.aborted) return;
        setProgress(`正在分類第 ${i + 1} / ${batches.length} 批…`);
        const indices = batches[i];
        try {
          const response = await fetch('/api/admin/questions/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(55000)]),
            body: JSON.stringify({ examSubject: subject, questions: indices.map(index => ({
              question: questions[index].question, options: questions[index].options, answer: questions[index].answer, explanation: questions[index].explanation,
            })) }) });
          const data = await response.json();
          if (!response.ok || !Array.isArray(data.results) || data.results.length !== indices.length) throw new Error('分類失敗');
          indices.forEach((index, position) => { next[index] = toReview(validateSuggestion(subject, data.results[position])); });
        } catch { /* This batch remains null; preserve successful earlier and later batches. */ }
      }
      if (!abort.signal.aborted) { setResult({ signature, rows: next }); setProgress('AI 章節分類完成'); }
    } finally { running.current = false; setBusy(false); }
  }

  async function prepare() {
    if (ready) return true;
    if (mode === 'ai' && !rows) await classify();
    return false; // Always stop for the review opportunity, even when every result is high confidence.
  }
  function review(index: number, chapter: string | null) {
    if (chapter !== null && !allowed.includes(chapter)) return;
    setResult(current => current?.signature === signature ? { ...current,
      rows: current.rows.map((row, i) => i === index ? { ...row, chapter, reviewed: true } : row) } : current);
  }
  const classifiedQuestions = questions.map((question, i) => ({ ...question,
    chapter: mode === 'later' ? null : mode === 'same' ? selectedChapter || null : rows?.[i]?.chapter ?? null }));
  return { mode, setMode, selectedChapter, setSameChapter, rows, busy, progress, pending, ready, classify, prepare, review,
    questions: classifiedQuestions };
}
