'use client';
import { useEffect, useState } from 'react';
import { waitForAnswerStatistics } from '@/lib/answer-statistics-client';
import type { questionDifficulty } from '@/lib/question-difficulty';
import styles from './option-distribution.module.css';
export default function QuestionDifficulty({ questionId }: { questionId: number }) {
  const [data,setData] = useState<ReturnType<typeof questionDifficulty> | null>(null);
  const [error,setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        await Promise.race([waitForAnswerStatistics(questionId),new Promise(resolve => setTimeout(resolve,1500))]);
        const response = await fetch(`/api/stats/difficulty?questionId=${questionId}`, { signal: AbortSignal.any([controller.signal,AbortSignal.timeout(8000)]),cache:'no-store' });
        if (!response.ok) throw new Error();
        const value = await response.json();
        if (!controller.signal.aborted) setData(value);
      } catch { if (!controller.signal.aborted) setError(true); }
    }
    void load();return () => controller.abort();
  },[questionId]);
  return <section className={styles.panel} aria-label="全站首次作答難度"><div className={styles.content}>{error ? <p>難度統計暫時無法讀取。</p> : !data ? <p role="status">正在讀取全站統計…</p> : <><p>共有 {data.total} 位使用者作答{data.rate !== null && ` · ${Math.round(data.rate*10)/10}% 答對`}</p><strong>{data.rate === null ? data.label : `難度：${data.label}`}</strong><p className={styles.caption}>沿用每人每題首次作答；至少 10 人才顯示難度。</p></>}</div></section>;
}
