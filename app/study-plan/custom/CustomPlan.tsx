"use client";
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { EXAM_SUBJECTS, chapterGroups } from '@/data/exam-chapters';
import { ProgressBar } from '@/components/dashboard/StudyUI';
import { CUSTOM_TARGET_MAX, formatPlanDate, parsePlanDate, parseCustomConfig, type CustomConfig, type CustomEstimate, type CustomView } from '@/lib/custom-plan';
import { syncDailyProgress } from '@/lib/daily-progress-client';
import styles from '../diagnostic/diagnostic.module.css';
import quiz from '@/app/questions/quiz.module.css';
import css from './custom.module.css';

const initial: CustomConfig = { target: 20, deadline: null, preferUnanswered: true, scope: [] };
const endpoint = '/api/study-plan/custom';
function Estimate({ value }: { value: CustomEstimate }) {
  return <div className={styles.stack} aria-live="polite">
    <p>目前符合範圍：{value.total + value.excluded} 題；本計畫目標 {value.total} 題，剩餘 {value.remaining} 題。</p>
    {value.excluded > 0 && <p className="study-muted">已排除先前做過的 {value.excluded} 題。</p>}
    <p>依每日 {value.target} 題，預估還需 {value.estimatedDays} 天，約 {formatPlanDate(value.estimatedDate)} 完成。</p>
    {value.suggested !== null && <p>系統建議：依剩餘 {value.days} 個有效日，每日約 {value.suggested} 題。</p>}
    {value.behind && <p className={css.notice}>以目前目標，可能無法在完成日期前做完。可自行調整每日題數或延長日期。</p>}
    {value.overdue && <p className={css.notice}>原訂完成日期已到，目前仍有 {value.remaining} 題尚未完成。可修改計畫以延長完成日期。</p>}
    {value.suggested !== null && value.suggested > CUSTOM_TARGET_MAX && <p>建議題數超過每日上限 {CUSTOM_TARGET_MAX} 題，請考慮延長日期。</p>}
  </div>;
}
export default function CustomPlan({ preview = false }: { preview?: boolean }) {
  const [data, setData] = useState<CustomView | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [guest, setGuest] = useState(false), [busy, setBusy] = useState(false), [editing, setEditing] = useState(false), [selected, setSelected] = useState('');
  const [config, setConfig] = useState<CustomConfig>(initial), [estimate, setEstimate] = useState<CustomEstimate | null>(null), [estimateError, setEstimateError] = useState('');
  const [reload, setReload] = useState(0);
  const [deadlineText, setDeadlineText] = useState('');
  const lock = useRef(false), heading = useRef<HTMLHeadingElement>(null);
  function receive(value: CustomView) {
    setData(value); setSelected('');
    try { syncDailyProgress(value); } catch { setNotice('進度已儲存至帳號，此瀏覽器錯題本暫時無法同步。'); }
  }
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        let response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start' }), signal: controller.signal, cache: 'no-store' });
        if (response.status === 409) response = await fetch(endpoint, { signal: controller.signal, cache: 'no-store' });
        if (response.status === 401) { setGuest(true); return; }
        const body = await response.json(); if (!response.ok) throw new Error(body.error);
        if (!controller.signal.aborted) { receive(body); setConfig(body.plan?.config ?? initial); setDeadlineText(body.plan?.config.deadline ? formatPlanDate(body.plan.config.deadline).replace('民國 ', '') : ''); setEditing(!body.plan); }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '無法載入計畫。'); }
    }
    void load(); return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    if (!editing) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setEstimate(null); setEstimateError('');
      if (!parseCustomConfig(config)) { setEstimateError('請設定每日題數或完成日期，並至少選擇一科。'); return; }
      try {
        const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', config }), signal: controller.signal });
        const body = await response.json(); if (!response.ok) throw new Error(body.error);
        if (!controller.signal.aborted) setEstimate(body);
      } catch (cause) { if (!controller.signal.aborted) setEstimateError(cause instanceof Error ? cause.message : '無法估算題目。'); }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [config, editing]);
  function change(value: CustomConfig) { setConfig(value); setEstimate(null); }
  async function send(method: 'POST' | 'PUT' | 'PATCH', body: unknown) {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(endpoint, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (response.status === 401) { setGuest(true); return; }
      const value = await response.json(); if (!response.ok) throw new Error(value.error);
      receive(value);
      if (method === 'PUT') { setEditing(false); setNotice('計畫已儲存。今日題目保持不變，新設定用於之後建立的任務。'); }
      requestAnimationFrame(() => heading.current?.focus());
    } catch (cause) { setError(cause instanceof Error ? cause.message : '儲存結果尚未確認，請重新載入。'); }
    finally { lock.current = false; setBusy(false); }
  }
  const refresh = <button className="study-button" disabled={busy} onClick={() => { setError(''); setReload(value => value + 1); }}>重新載入自訂進度</button>;
  if (guest) return <section className={`study-card ${styles.stack}`}><h2>請先登入</h2><Link href="/login" className="study-button">登入帳號</Link></section>;
  if (!data) return <section className={`study-card ${styles.stack}`}>{error ? <><p role="alert">{error}</p>{refresh}</> : <p role="status">讀取自訂進度中…</p>}</section>;
  if (data.mode !== 'custom') return <section className={`study-card ${styles.stack}`}><h2>自訂計畫已保留</h2><p>切換回自訂進度模式後即可繼續。</p><Link href="/study-plan" className="study-button">設定學習模式</Link></section>;
  const plan = data.plan, task = data.task, current = task?.current;
  return <div className={styles.stack} aria-busy={busy}>
    {error && <section className={`study-card ${styles.stack}`}><p role="alert">{error}</p>{refresh}</section>}
    {notice && <p role="status">{notice}</p>}
    {plan && <section className={`study-card ${styles.stack}`}>
      <h2 ref={heading} tabIndex={-1}>{plan.status === 'paused' ? '計畫已暫停' : plan.status === 'completed' ? '計畫完成' : '我的學習計畫'}</h2>
      <p>你的目標：{plan.config.target === null ? `依日期建議安排（目前每日 ${plan.estimate.target} 題）` : `每日 ${plan.config.target} 題`} · 完成日期：{formatPlanDate(plan.config.deadline)}</p>
      <ul>{plan.config.scope.map(row => <li key={row.subject}>{row.subject}：{row.chapters.length ? row.chapters.join('、') : '整科（所有可用題目）'}</li>)}</ul>
      <h3>整體進度</h3><p>{plan.estimate.completed} / {plan.estimate.total} 題</p>
      <ProgressBar value={plan.estimate.total ? plan.estimate.completed / plan.estimate.total * 100 : 0} label="整體進度百分比" />
      <p>累計完成 {plan.estimate.answered} 題 · 整體正確率 {plan.estimate.answered ? `${Math.round(plan.estimate.correct / plan.estimate.answered * 100)}%` : '尚無作答'}</p>
      <p className="study-muted">開始：{formatPlanDate(plan.started)}{plan.completedAt ? ` · 完成：${formatPlanDate(plan.completedAt)}` : ''}</p>
      {plan.status !== 'completed' && <Estimate value={plan.estimate} />}
      <h3>今日進度 · {formatPlanDate(data.date)}</h3>
      {task ? <><p role="status">已完成 {task.answered} / {task.total} 題（今日目標 {task.target} 題）</p><ProgressBar value={task.answered / task.total * 100} label="今日進度百分比" />
        {task.completed ? <p>今日進度完成，正確 {task.correct} / {task.total} 題。</p> : plan.status !== 'paused' && preview && <Link href="/study-plan/custom" className="study-button study-button-primary">繼續今日進度</Link>}
      </> : plan.status === 'paused' ? <p>恢復計畫後可繼續安排進度。</p> : plan.estimate.remaining > 0 ? <button className="study-button study-button-primary" disabled={busy} onClick={() => void send('POST', { action: 'start' })}>開始今日進度</button> : <p>{plan.estimate.total ? '符合目前設定的練習題目已完成。' : '目前此範圍尚無待練習題目，可修改計畫。'}</p>}
      <div className={css.actions}><button className="study-button" disabled={busy} onClick={() => { setConfig(plan.config); setDeadlineText(plan.config.deadline ? formatPlanDate(plan.config.deadline).replace('民國 ', '') : ''); setEditing(true); setEstimate(null); }}>修改計畫</button><button className="study-button" disabled={busy} onClick={() => void send('PATCH', { paused: plan.status !== 'paused' })}>{plan.status === 'paused' ? '恢復計畫' : '暫停目前計畫'}</button></div>
      <p className="study-muted">未完成題目會留在剩餘範圍，不會加倍累積隔日目標。符合範圍的新題從下一天納入；已建立的今日題目固定。</p>
      {data.history.length > 0 && <details><summary>近期每日紀錄</summary><ul>{data.history.map(row => <li key={row.date}>{formatPlanDate(row.date)}：{row.answered} / {row.total} 題</li>)}</ul></details>}
    </section>}
    {editing && <section className={`study-card ${styles.stack}`}><h2>{plan ? '修改學習計畫' : '建立學習計畫'}</h2>
      <form className={css.form} onSubmit={event => { event.preventDefault(); if (estimate && parseCustomConfig(config)) void send('PUT', config); }}>
        <fieldset disabled={busy}><legend>每日題數</legend><div className={css.choices}>{[10, 20, 30, 50].map(value => <button type="button" key={value} className="study-button" aria-pressed={config.target === value} onClick={() => change({ ...config, target: value })}>{value} 題</button>)}</div>
          <label htmlFor="custom-target">自訂題數（1～{CUSTOM_TARGET_MAX}）</label><input id="custom-target" type="number" min={1} max={CUSTOM_TARGET_MAX} value={config.target ?? ''} onChange={event => change({ ...config, target: event.target.value ? Number(event.target.value) : null })} />
          <p className="study-muted">留空時須設定完成日期，系統每天依剩餘題目與天數安排，最多 {CUSTOM_TARGET_MAX} 題。自行設定題數後，系統只提供建議，不會自動更改。</p>
        </fieldset>
        <fieldset disabled={busy}><legend>完成日期（選填）</legend><label htmlFor="custom-deadline">民國年／月／日</label><input id="custom-deadline" type="text" placeholder="例如 115/6/30" maxLength={10} value={deadlineText} aria-invalid={config.deadline === 'invalid'} onChange={event => { setDeadlineText(event.target.value); change({ ...config, deadline: parsePlanDate(event.target.value) }); }} /><p>{config.deadline === 'invalid' ? '請輸入有效民國日期，例如 115/6/30。' : formatPlanDate(config.deadline)}</p></fieldset>
        <fieldset disabled={busy}><legend>練習範圍</legend>{EXAM_SUBJECTS.map(subject => {
          const part = config.scope.find(row => row.subject === subject);
          return <div key={subject}><label><input type="checkbox" checked={!!part} onChange={event => change({ ...config, scope: event.target.checked ? [...config.scope, { subject, chapters: [] }] : config.scope.filter(row => row.subject !== subject) })} />{subject}</label>
            {part && <details><summary>{part.chapters.length ? `已選 ${part.chapters.length} 個章節` : '整科 · 可指定章節'}</summary><p className="study-muted">未勾選任何章節即整科，包含尚未分類的可用題目。</p><div className={css.chapters}>{chapterGroups(subject).flatMap(group => group.chapters).map(chapter => <label key={chapter}><input type="checkbox" checked={part.chapters.includes(chapter)} onChange={event => change({ ...config, scope: config.scope.map(row => row.subject !== subject ? row : { ...row, chapters: event.target.checked ? [...row.chapters, chapter] : row.chapters.filter(value => value !== chapter) }) })} />{chapter}</label>)}</div></details>}
          </div>;
        })}</fieldset>
        <label><input type="checkbox" disabled={busy} checked={config.preferUnanswered} onChange={event => change({ ...config, preferUnanswered: event.target.checked })} />優先安排未做過題目</label><p className="study-muted">勾選時排除先前已做過的題目；取消可納入舊題。本計畫每題只完成一次，不會循環重刷。</p>
        {estimate ? <Estimate value={estimate} /> : <p role="status">{estimateError || '估算範圍題目中…'}</p>}
        <div className={css.actions}><button className="study-button study-button-primary" disabled={busy || !estimate} type="submit">{busy ? '儲存中…' : plan ? '儲存計畫' : '建立計畫'}</button>{plan && <button type="button" className="study-button" disabled={busy} onClick={() => setEditing(false)}>取消修改</button>}</div>
      </form>
    </section>}
    {!preview && !editing && current && task && plan?.status !== 'paused' && <section className={`study-card ${styles.stack}`}>
      <p>第 {current.position} 題</p><h2 className={quiz.question}>{current.question}</h2>
      {current.image && <img className={styles.image} src={current.image} alt="本題附圖" /> /* eslint-disable-line @next/next/no-img-element */}
      <div className={quiz.options} role="group" aria-label="自訂進度答案選項">{current.options.map((option, index) => { const letter = String.fromCharCode(65 + index); return option.trim() ? <button key={`${task.id}-${current.position}-${letter}`} className={`${quiz.option} ${selected === letter ? quiz.selected : ''}`} disabled={busy} aria-pressed={selected === letter} onClick={() => setSelected(letter)}><span className={quiz.letter}>{letter}</span><span className={quiz.optionText}>{option}</span></button> : null; })}</div>
      <button className="study-button study-button-primary" disabled={busy || !selected} onClick={() => void send('PATCH', { taskId: task.id, position: current.position, answer: selected })}>{busy ? '儲存中…' : '送出並繼續'}</button>
    </section>}
  </div>;
}
