'use client';
import { useEffect, useState } from 'react';
import { EXAM_SUBJECTS } from '@/data/exam-chapters';
import { chapterFrequency, type FrequencyInput } from '@/lib/chapter-frequency';
import styles from './analysis.module.css';
export default function Frequency() {
  const [input, setInput] = useState<FrequencyInput[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [subject, setSubject] = useState<string>(EXAM_SUBJECTS[0]);
  const [years, setYears] = useState<5 | 10 | null>(5);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/stats/chapter-frequency', { signal: controller.signal }).then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(data => setInput(data.rows)).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [retry]);
  const summary = chapterFrequency(input ?? [], years);
  return <section className={styles.subjectSection} aria-labelledby="frequency-title">
    <div className={styles.sectionHeader}><h2 id="frequency-title">歷屆章節出題頻率</h2><p>依官方固定章節整理</p></div>
    <div className="my-4 flex flex-wrap gap-3"><label>科目 <select className="max-w-full rounded-xl border p-3" value={subject} onChange={event => setSubject(event.target.value)}>{EXAM_SUBJECTS.map(name => <option key={name}>{name}</option>)}</select></label><div className="flex flex-wrap gap-2" aria-label="出題期間">{([null,10,5] as const).map(value => <button key={value ?? 'all'} aria-pressed={years === value} className={`study-button ${years === value ? 'study-button-primary' : ''}`} onClick={() => setYears(value)}>{value ? `最近 ${value} 年` : '全期間'}</button>)}</div></div>
    {error ? <p role="status">出題頻率暫時無法讀取。<button className="study-button" onClick={() => { setError(false); setRetry(value => value + 1); }}>重試</button></p> : input === null ? <p role="status">正在整理歷屆題目…</p> : <>
      <p className={styles.description}>以題庫最新收錄年份 {summary.latestYear ?? '未知'} 為基準。平均值＝該章節題數 ÷ 同科收錄試卷數（包含該章節零題的試卷）。這是已收錄題庫的頻率，不代表完整歷屆考試；期間內有 {summary.unclassified} 題尚未歸入官方章節。</p>
      <div className={styles.subjectGrid}>{summary.rows.filter(row => row.subject === subject).map(row => <article className={styles.subjectCard} key={row.chapter}><h3>{row.chapter}</h3><p><strong>{row.count}</strong> 題</p><small>平均每份收錄試卷 {row.average === null ? '—' : row.average.toFixed(1)} 題 · {row.papers} 份</small></article>)}</div>
    </>}
  </section>;
}
