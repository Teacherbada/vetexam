"use client";
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ProgressBar } from '@/components/dashboard/StudyUI';
import type { FollowUpView } from '@/lib/follow-up';
import { FOLLOW_UP_QUESTION_COUNT } from '@/lib/follow-up-config';
import styles from '../diagnostic/diagnostic.module.css';
import quiz from '@/app/questions/quiz.module.css';
export default function FollowUp({ id }: { id?: string }) {
  const [data, setData] = useState<FollowUpView | null>(null);
  const [guest, setGuest] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState('');
  const locked = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const endpoint = '/api/study-plan/follow-up';
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(endpoint + (id ? `?id=${encodeURIComponent(id)}` : ''), { cache: 'no-store', signal: controller.signal });
        if (response.status === 401) { if (!controller.signal.aborted) setGuest(true); return; }
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (!controller.signal.aborted) { setData(body); setGuest(false); setSelected(''); }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '追蹤暫時無法載入。'); }
    }
    void load(); return () => controller.abort();
  }, [id, reload]);
  async function send(answer = false) {
    if (locked.current || !data?.followUp) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(endpoint, { method: answer ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        followUpId: data.followUp.id, ...(answer ? { sessionId: data.session?.id, position: data.session?.current?.position, answer: selected } : {}),
      }) });
      if (response.status === 401) { setGuest(true); setData(null); return; }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setData(body); setSelected(''); requestAnimationFrame(() => heading.current?.focus());
    } catch (cause) { setError(cause instanceof Error ? cause.message : '請重新載入確認儲存進度。'); }
    finally { locked.current = false; setBusy(false); }
  }
  const refresh = <button className="study-button" disabled={busy} onClick={() => { setData(null); setError(''); setReload(value => value + 1); }}>重新載入追蹤</button>;
  if (guest) return <section className={`study-card ${styles.stack}`}><h2>請先登入</h2><Link href="/login" className="study-button">登入帳號</Link></section>;
  if (!data) return <section className={`study-card ${styles.stack}`}>{error ? <><p role="alert">{error}</p>{refresh}</> : <p role="status">讀取追蹤進度中…</p>}</section>;
  if (data.mode !== 'coach') return <section className={`study-card ${styles.stack}`}><h2>先選擇國考教練模式</h2><Link href="/study-plan" className="study-button">設定學習模式</Link></section>;
  const followUp = data.followUp, session = data.session, current = session?.current;
  const finalStage = followUp && followUp.stage === followUp.intervals.length;
  return <div className={styles.stack} aria-busy={busy}>
    {error && <section className={`study-card ${styles.stack}`}><p role="alert">{error}</p>{refresh}</section>}
    <section className={`study-card ${styles.stack}`}>
      <h2 ref={heading} tabIndex={-1}>{followUp ? `${followUp.subject} → ${followUp.chapter}` : '目前沒有複習追蹤'}</h2>
      {!followUp ? <p>完成補強並通過立即驗證後，會安排後續確認。</p> : <>
        <p>第 {followUp.stage} / {followUp.intervals.length} 階段追蹤 · 可進行時間：{new Date(followUp.due_at).toLocaleString('zh-TW')}</p>
        {followUp.status === 'pending' && <p role="status">尚未到追蹤時間。目前保持短期掌握，之後再回來確認。</p>}
        {followUp.status === 'due' && !session && <><p>這項複習追蹤已可進行。用最多 {FOLLOW_UP_QUESTION_COUNT} 題快速確認是否還記得；題庫不足時會使用較少題目或之前做過的題目。</p>{data.activeReinforcement ? <><p>先繼續目前的補強任務，這項追蹤會保留。</p><Link href="/study-plan/reinforcement" className="study-button">繼續補強任務</Link></> : <button className="study-button study-button-primary" disabled={busy} onClick={() => void send()}>{busy ? '準備中…' : '開始快速確認'}</button>}</>}
        {followUp.result && <><h3>{followUp.result.passed ? finalStage ? '掌握穩定' : '本階段追蹤通過・短期掌握' : '需要再次補強'}</h3><p>{followUp.result.correct} / {followUp.result.total} 題正確</p>
          <p>{followUp.result.passed ? finalStage ? '你在補強後的後續追蹤中仍保持良好表現。一般練習仍會正常出現這個章節。' : '目前表現穩定，我們之後還會再確認一次。' : followUp.result.sufficient ? '這個章節目前仍有些不穩定，建議再次複習。已加入補強佇列，之前的成功紀錄會保留。' : '本次題目數不足，暫不能判定持續掌握。已保留結果並加入補強佇列。'}</p>
          <p className="study-muted">這是本次少量題目的追蹤結果，並非永久掌握的保證。完成時間：{new Date(followUp.completed_at!).toLocaleString('zh-TW')}</p>
        </>}
        {followUp.status === 'cancelled' && <p>這項追蹤已結束，請回國考教練查看最新建議。</p>}
      </>}
      <Link href="/study-plan" className="study-button">繼續國考教練</Link>
    </section>
    {session && !session.completed && current && <section className={`study-card ${styles.stack}`}>
      <h2>快速確認</h2><p role="status">已儲存 {session.answered} / {session.total} 題</p><ProgressBar value={session.answered / session.total * 100} label="追蹤完成百分比" />
      <p className="study-muted">第 {current.position} 題 · {current.subject} · {current.chapter}</p><h3 className={quiz.question}>{current.question}</h3>
      {current.image && <img className={styles.image} src={current.image} alt="本題附圖" /> /* eslint-disable-line @next/next/no-img-element */}
      <div className={quiz.options} role="group" aria-label="追蹤答案選項">{current.options.map((option, index) => {
        if (!option.trim()) return null;
        const letter = String.fromCharCode(65 + index);
        return <button key={`${current.position}-${letter}`} className={`${quiz.option} ${selected === letter ? quiz.selected : ''}`} disabled={busy} aria-pressed={selected === letter} onClick={() => setSelected(letter)}><span className={quiz.letter}>{letter}</span><span className={quiz.optionText}>{option}</span></button>;
      })}</div>
      <button className="study-button study-button-primary" disabled={busy || !selected} onClick={() => void send(true)}>{busy ? '儲存中…' : session.answered + 1 === session.total ? '送出並完成追蹤' : '送出並繼續'}</button>
    </section>}
    {data.history.length > 0 && <section className={`study-card ${styles.stack}`}><h2>追蹤紀錄</h2><ul>{data.history.map(row => <li key={row.id}><Link href={`/study-plan/follow-up?id=${row.id}`}>{row.subject} → {row.chapter} · 第 {row.review_attempt} 次複習／第 {row.stage} 階段</Link>：{row.result ? `${row.result.correct} / ${row.result.total} 題，${row.result.passed ? '通過' : '待補強'}` : row.status === 'due' ? '已可進行' : row.status === 'pending' ? '等待追蹤' : '已取消'}</li>)}</ul></section>}
  </div>;
}
