'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import PageHeader from "@/components/ui/PageHeader";
import foundation from "@/components/ui/foundation.module.css";
import review from './review.module.css';
import Link from 'next/link';
import QuestionCard, { type QuizQuestion } from '@/components/questions/QuestionCard';
import LearningStatus from '@/components/LearningStatus';
import { getFavorites, toggleFavorite } from '@/data/favorites';
import { enqueueLearning, getLearningStatus, learningOwner, retryLearning, subscribeLearning } from '@/lib/learning-client';
import type { DueReview as ReviewData } from '@/lib/due-review';
import styles from '@/app/questions/quiz.module.css';

export default function DueReview() {
  const owner = useSyncExternalStore(subscribeLearning, learningOwner, () => null);
  const status = useSyncExternalStore(subscribeLearning, getLearningStatus, () => 'loading');
  const [data, setData] = useState<ReviewData | null>(null);
  const [current, setCurrent] = useState<QuizQuestion | null>(null);
  const [selected, setSelected] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(0);
  const [favorites, setFavorites] = useState<ReturnType<typeof getFavorites>>([]);
  const locked = useRef(false);
  const pending = useRef<{ event_id: string; question_id: number; selected_answer: string; answered_at: string; queued: boolean } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/review/due', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    const next: ReviewData & { error?: string } = await response.json();
    if (!response.ok) throw new Error(next.error || '讀取失敗，請稍後重試。');
    if (next.owner !== owner || learningOwner() !== owner) throw new Error('帳號已變更，請重新載入。');
    setData(next);
    return next;
  }, [owner]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setData(null); setCurrent(null); setSelected(''); setSaved(false); setCompleted(0); setError('');
      pending.current = null;
      if (owner) void load().catch(e => { if (active) setError(e.message); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [owner, load]);
  useEffect(() => {
    const update = () => setFavorites(getFavorites());
    const timer = window.setTimeout(update, 0);
    const unsubscribe = subscribeLearning(update);
    return () => { window.clearTimeout(timer); unsubscribe(); };
  }, []);

  async function start() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      await retryLearning();
      if (learningOwner() !== owner || getLearningStatus() !== 'ready') throw new Error('請先完成帳號同步，再開始複習。');
      const next = await load();
      setCurrent(next.queue[0] ?? null); setSelected(''); setSaved(false); pending.current = null;
    } catch (e) { setError(e instanceof Error ? e.message : '讀取失敗'); }
    finally { locked.current = false; setBusy(false); }
  }

  async function answer(letter: string) {
    if (!current || locked.current || saved || learningOwner() !== data?.owner) return;
    locked.current = true; setBusy(true); setError('');
    const forOwner = data.owner;
    try {
      const event = pending.current ??= { event_id: crypto.randomUUID(), question_id: current.id, selected_answer: letter, answered_at: new Date().toISOString(), queued: false };
      setSelected(event.selected_answer);
      if (!event.queued) {
        const { queued: _queued, ...submission } = event;
        void _queued;
        event.queued = enqueueLearning({ action: 'answers', mode: 'practice', answers: [submission] });
        if (!event.queued) throw new Error('無法保存作答，請重試。');
      }
      await retryLearning();
      if (learningOwner() !== forOwner || getLearningStatus() !== 'ready') throw new Error('作答尚未同步，請重試；重送不會重複計算。');
      await load();
      setSaved(true); setCompleted(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : '儲存失敗'); }
    finally { locked.current = false; setBusy(false); }
  }

  const validData = data?.owner === owner ? data : null;
  return <main className={`${foundation.foundation} ${styles.page} ${review.page}`}><div className={review.container}>
    <Link href="/study-plan" className="study-button">回學習計畫</Link>
    <LearningStatus />
    <section className={review.summary}>
      <PageHeader title="到期複習" />
      {!owner ? <p>{status === 'loading' ? '載入中…' : <Link href="/login" className="study-button">登入後查看到期複習</Link>}</p> : validData ? <>
        <p className={review.due}>今天待複習 <strong>{validData.dueToday} 題</strong><small>現在可複習 {validData.dueNow} 題</small></p>
        <p>未來 7 天 <strong>{validData.upcoming7Days} 題</strong></p>
        {completed > 0 && <p role="status">已完成 {completed} 題，下次系統會再安排。</p>}
        {!current && (validData.dueNow ? <div className={review.actions}><button className="study-button study-button-primary" disabled={busy} onClick={start}>開始到期複習</button></div> : <>
          <p>{validData.dueToday === 0 ? '今天沒有需要複習的題目' : '目前沒有到期複習，今天稍後還有題目到期。'}</p>
          <p>未來 7 天預計有 {validData.upcoming7Days} 題</p>
          <button className="study-button" disabled={busy} onClick={start}>重新整理</button>
        </>)}
      </> : <p>正在讀取到期題目…</p>}
      {error && <div role="alert"><p>{error}</p><button className="study-button" disabled={busy} onClick={() => pending.current ? answer(pending.current.selected_answer) : start()}>重試</button></div>}
    </section>
    {current && validData && <section className={styles.card} aria-label="到期複習題目">
      <div className={styles.meta}><span>{current.subject}</span><span className={styles.tag}>到期複習</span></div>
      <QuestionCard currentQuestion={current} selected={selected} showResult={saved} answered={busy || !!selected} isFavorite={favorites.some(q => q.id === current.id)} favoriteQuestion={() => setFavorites(toggleFavorite(current))} chooseAnswer={answer} />
      <div className={styles.actions}>{saved ? <><p>已完成，下次系統會再安排。</p><button disabled={busy} className="study-button study-button-primary" onClick={start}>{validData.dueNow ? '繼續到期複習' : '完成複習'}</button></> : <p>{busy ? '正在儲存作答…' : '點選答案後即鎖定，並顯示答案與解析。'}</p>}</div>
    </section>}
  </div></main>;
}
