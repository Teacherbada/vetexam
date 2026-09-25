'use client';
import { useEffect, useState } from 'react';
import { EXAM_SUBJECTS } from '@/data/exam-chapters';
import { chapterFrequency, type FrequencyInput } from '@/lib/chapter-frequency';
import { learningPriorities } from '@/lib/learning-priorities';
import type { History } from '@/lib/learning-client';
import styles from './analysis.module.css';
export default function Frequency({ history }: { history?: History[] }) {
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
  const priorities = learningPriorities(history ?? [], chapterFrequency(input ?? [], 5).rows);
  return <section className={styles.subjectSection} aria-labelledby="frequency-title">
    <div className={styles.sectionHeader}><h2 id="frequency-title">歷屆章節出題頻率</h2><p>依官方固定章節整理</p></div>
    <div className="my-4 flex flex-wrap gap-3"><label>科目 <select className="max-w-full rounded-xl border p-3" value={subject} onChange={event => setSubject(event.target.value)}>{EXAM_SUBJECTS.map(name => <option key={name}>{name}</option>)}</select></label><div className="flex flex-wrap gap-2" aria-label="出題期間">{([null,10,5] as const).map(value => <button key={value ?? 'all'} aria-pressed={years === value} className={`study-button ${years === value ? 'study-button-primary' : ''}`} onClick={() => setYears(value)}>{value ? `最近 ${value} 年` : '全期間'}</button>)}</div></div>
    {error ? <p role="status">出題頻率暫時無法讀取。<button className="study-button" onClick={() => { setError(false); setRetry(value => value + 1); }}>重試</button></p> : input === null ? <p role="status">正在整理歷屆題目…</p> : <>
      <p className={styles.description}>以題庫最新收錄年份 {summary.latestYear ?? '未知'} 為基準。平均值＝該章節題數 ÷ 同科收錄試卷數（包含該章節零題的試卷）。這是已收錄題庫的頻率，不代表完整歷屆考試；期間內有 {summary.unclassified} 題尚未歸入官方章節。</p>
      <div className={styles.subjectGrid}>{summary.rows.filter(row => row.subject === subject).map(row => <article className={styles.subjectCard} key={row.chapter}><h3>{row.chapter}</h3><p><strong>{row.count}</strong> 題</p><small>平均每份收錄試卷 {row.average === null ? '—' : row.average.toFixed(1)} 題 · {row.papers} 份</small></article>)}</div>
      {history && <section className="mt-6" aria-labelledby="priorities-title"><h2 id="priorities-title">弱點 × 出題頻率：建議優先複習</h2><p className={styles.description}>每章節至少作答 10 題不同題目，以每題最後一次作答計算。正確率低於 80% 才列入，依「錯誤比例 × 此章節近 5 年占同科題數比例」排序；高頻指同科有出題章節的前約三分之一。</p>
        {priorities.length ? <div className={styles.subjectGrid}>{priorities.map(row => <article className={styles.subjectCard} key={`${row.subject}:${row.chapter}`}><small>{row.subject}</small><h3>{row.chapter}</h3><p>你的正確率 {Math.round(row.accuracy*100)}% · {row.answered} 題</p><p>近 5 年 {row.count} 題 · 占同科 {(row.share*100).toFixed(1)}%</p><strong>{row.high ? '高頻 × 個人弱項' : '個人弱項'}</strong><p>{row.high ? '你的正確率偏低，而且此章節近 5 年出題頻率較高。' : '此章節仍有加強空間；已依歷屆頻率安排優先順序。'}</p><a className="study-button" href={`/questions?${new URLSearchParams({ groups: JSON.stringify([{ subject:row.subject,chapter:row.chapter,years:[],count:'20' }]),order:'random',mode:'practice',started:'1' })}`}>練習此章節</a></article>)}</div> : <p>目前沒有足夠的章節作答與出題資料可推薦，請先繼續練習。</p>}
      </section>}
    </>}
  </section>;
}
