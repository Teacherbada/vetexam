'use client';

import { useEffect, useRef, useState } from 'react';
import { EXAM_SUBJECTS } from '@/data/exam-chapters';
import type { ChapterQueue } from '@/lib/admin-question-chapters';
import ChapterPicker from '@/components/questions/ChapterPicker';
import { formatExamYear } from '@/lib/exam-year';
import styles from './pdf.module.css';

type Bank = { id: number; name: string; exam_subject: string | null };
const endpoint = '/api/admin/questions/chapters';

export default function QuestionChapters({ banks, importedSetId, importedSubject, disabled }: {
  banks: Bank[]; importedSetId: number | null; importedSubject: string; disabled: boolean;
}) {
  const [subject, setSubject] = useState(importedSetId && EXAM_SUBJECTS.includes(importedSubject) ? importedSubject : EXAM_SUBJECTS[0]);
  const [setId, setSetId] = useState(importedSetId ? String(importedSetId) : '');
  const [status, setStatus] = useState('unclassified');
  const [after, setAfter] = useState(0);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<ChapterQueue | null>(null);
  const [chapter, setChapter] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const operation = useRef(false);
  const alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ subject, status });
    if (setId) params.set('question_set_id', setId);
    if (after) params.set('after', String(after));
    fetch(`${endpoint}?${params}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || '讀取章節分類失敗'); return result as ChapterQueue; })
      .then(result => { if (!controller.signal.aborted) { setData(result); setChapter(result.question?.chapter ?? ''); setLoading(false); } })
      .catch(e => { if (!controller.signal.aborted) { setData(null); setError(e.message); setLoading(false); } });
    return () => controller.abort();
  }, [subject, status, setId, after, revision]);

  function reload(cursor = 0) { setLoading(true); setError(''); setChapter(''); setAfter(cursor); setRevision(value => value + 1); }
  function changeSubject(value: string) { setSubject(value); setSetId(''); setNotice(''); reload(); }
  async function save() {
    if (!data?.question || !chapter || loading || disabled || operation.current) return;
    const current = data.question;
    operation.current = true; setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: current.id, chapter, previousChapter: current.chapter }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '儲存失敗，請重試');
      if (!alive.current) return;
      setNotice(`已儲存第 ${current.question_number} 題（ID ${current.id}）的章節：${result.chapter}`);
      reload(current.id);
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '儲存失敗'); }
    finally { operation.current = false; if (alive.current) setSaving(false); }
  }

  const current = data?.question;
  return <section className={`${styles.card} mt-7 min-w-0`} aria-labelledby="chapter-tool-title">
    <h2 id="chapter-tool-title">既有題目章節分類</h2>
    <p className="mt-2 text-sm text-[#6F7873]">匯入後可在這裡逐題指定章節，也可修改已分類題目。</p>
    <fieldset disabled={saving || disabled} className="mt-5 min-w-0">
      <div className={styles.grid}>
        <label className={styles.field}>分類科目<select aria-label="分類科目" value={subject} onChange={e => changeSubject(e.target.value)} className="w-full min-w-0 rounded-xl border bg-white p-3">{EXAM_SUBJECTS.map(item => <option key={item}>{item}</option>)}</select></label>
        <label className={styles.field}>分類狀態<select aria-label="分類狀態" value={status} onChange={e => { setStatus(e.target.value); setNotice(''); reload(); }} className="w-full min-w-0 rounded-xl border bg-white p-3"><option value="all">全部</option><option value="unclassified">未分類</option><option value="classified">已分類</option></select></label>
        <label className={`${styles.field} min-w-0`}>分類題庫<select aria-label="分類題庫" value={setId} onChange={e => { setSetId(e.target.value); setNotice(''); reload(); }} className="w-full min-w-0 rounded-xl border bg-white p-3"><option value="">全部題庫（公開與私人）</option>{banks.map(bank => <option key={bank.id} value={bank.id}>{bank.name} · #{bank.id}</option>)}</select></label>
      </div>
      {notice && <p role="status" className={`${styles.status} ${styles.success}`}>{notice}</p>}
      {error && <div role="alert" className={`${styles.status} ${styles.error}`}>{error}<button type="button" className={styles.secondary} onClick={() => reload(after)}>重新讀取</button></div>}
      {loading ? <p role="status" className="mt-4">載入章節分類中…</p> : data && <>
        <p className={styles.status}>分類進度：已分類 {data.progress.classified} / {data.progress.total}（{data.progress.total ? (data.progress.classified / data.progress.total * 100).toFixed(1) : '0'}%） · 未分類 {data.progress.unclassified}</p>
        {current ? <article className="mt-5 min-w-0" aria-label="目前分類題目">
          <h3 className="font-bold">第 {current.question_number} 題 · ID {current.id}</h3>
          <p className="mt-2 break-words text-sm text-[#6F7873]">{current.subject} · {formatExamYear(current.exam_year)} · {current.question_set_name} · {current.visibility === 'public' ? '公開' : '私人'}</p>
          <p className="mt-4 whitespace-pre-wrap break-words text-lg font-semibold">{current.question}</p>
          {[current.option_a, current.option_b, current.option_c, current.option_d, current.option_e].map((option, index) => (index < 4 || option) && <p className="mt-3 whitespace-pre-wrap break-words" key={index}>{String.fromCharCode(65 + index)}. {option || '（未提供）'}</p>)}
          <p className="mt-4 whitespace-pre-wrap break-words text-sm">正確答案：{current.answer || '尚未設定'}</p>
          {current.explanation && <details className="mt-3"><summary className="cursor-pointer text-sm">查看既有解析</summary><p className="mt-2 whitespace-pre-wrap break-words">{current.explanation}</p></details>}
          <p className="my-4 break-words text-sm text-[#6F7873]">目前章節：{current.chapter || '未分類'}</p>
          <ChapterPicker key={current.id} subject={current.subject} value={chapter} onChange={setChapter} emptyLabel="請選擇章節" allowEmpty={false} />
          <div className={styles.actions}><button type="button" className={styles.primary} disabled={!chapter || saving || loading} onClick={save}>{saving ? '儲存中…' : '儲存並下一題'}</button><button type="button" className={styles.secondary} onClick={() => { setNotice(''); reload(current.id); }}>略過／下一題</button></div>
        </article> : <p role="status" className="mt-4">{data.matching ? '已到此輪最後一題，可從第一題重新查看。' : '目前沒有符合條件的題目。'}</p>}
        <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => { setNotice(''); reload(); }}>從第一題重新讀取</button></div>
      </>}
    </fieldset>
  </section>;
}
