"use client";
import Link from 'next/link';
import { useEffect,useRef,useState } from 'react';
import { ProgressBar } from '@/components/dashboard/StudyUI';
import { DAILY_TARGET_MIN,DAILY_TARGET_MAX } from '@/lib/daily-task-config';
import { validDailyTarget,type DailyView } from '@/lib/daily-task';
import { syncDailyProgress } from '@/lib/daily-progress-client';
import { REINFORCEMENT_LABELS, type ReinforcementStatus } from '@/lib/reinforcement';
import styles from '../diagnostic/diagnostic.module.css';
import quiz from '@/app/questions/quiz.module.css';
export default function DailyTask({preview=false}:{preview?:boolean}) {
  const [data,setData]=useState<DailyView|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false),[guest,setGuest]=useState(false),[selected,setSelected]=useState(''),[target,setTarget]=useState('');
  const [reload,setReload]=useState(0);
  const locked=useRef(false),heading=useRef<HTMLHeadingElement>(null);
  const endpoint='/api/study-plan/daily';
  function receive(body: DailyView) {
    setData(body);setGuest(false);setSelected('');setTarget(String(body.target));
    try {syncDailyProgress(body);} catch {setNotice('作答已儲存至帳號，但此瀏覽器的錯題本或進度暫時無法同步。');}
  }
  useEffect(()=>{
    const controller=new AbortController();
    async function load() {
      try {
        const response=await fetch(endpoint,{method:'POST',signal:controller.signal,cache:'no-store'});
        if(response.status===401) {if(!controller.signal.aborted)setGuest(true);return;}
        // Custom/unset mode is read-only; do not auto-create a coach plan.
        if(response.status===409) {
          const existing=await fetch(endpoint,{signal:controller.signal,cache:'no-store'});
          if(existing.ok && !controller.signal.aborted) {receive(await existing.json());return;}
        }
        const body=await response.json();if(!response.ok)throw new Error(body.error);
        if(!controller.signal.aborted)receive(body);
      } catch(cause) {if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'每日任務暫時無法載入。');}
    }
    void load();return()=>controller.abort();
  },[reload]);
  async function send(action:'answer'|'target') {
    if(locked.current)return;locked.current=true;setBusy(true);setError('');setNotice('');
    try {
      const response=await fetch(endpoint,{method:action==='target'?'PATCH':'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(action==='target'?{target:Number(target)}:{taskId:data?.task?.id,position:data?.task?.current?.position,answer:selected})});
      if(response.status===401){setGuest(true);setData(null);return;}
      const body=await response.json();if(!response.ok)throw new Error(body.error);
      receive(body);if(action==='target')setNotice('每日目標已儲存；今天已建立的題目保持不變，新的目標會用於之後建立的任務。');
      requestAnimationFrame(()=>heading.current?.focus());
    } catch(cause){setError(cause instanceof Error?cause.message:'無法確認儲存結果，請重新載入。');}
    finally{locked.current=false;setBusy(false);}
  }
  const refresh=<button className="study-button" disabled={busy} onClick={()=>{setData(null);setError('');setReload(n=>n+1);}}>重新載入今日任務</button>;
  if(guest)return <section className={`study-card ${styles.stack}`}><h2>請先登入</h2><Link href="/login" className="study-button">登入帳號</Link></section>;
  if(!data)return <section className={`study-card ${styles.stack}`}>{error?<><p role="alert">{error}</p>{refresh}</>:<p role="status">準備今日學習中…</p>}</section>;
  if(data.mode!=='coach')return <section className={`study-card ${styles.stack}`}><h2>先選擇國考教練模式</h2><Link href="/study-plan" className="study-button">設定學習模式</Link></section>;
  const task=data.task,current=task?.current;
  return <div className={styles.stack} aria-busy={busy}>
    {error&&<section className={`study-card ${styles.stack}`}><p role="alert">{error}</p>{refresh}</section>}
    {notice&&<p role="status">{notice}</p>}
    <section className={`study-card ${styles.stack}`}>
      <h2 ref={heading} tabIndex={-1}>{task?.completed?'今日任務完成':'今日學習'}</h2><p className="study-muted">{data.date} · 台北時間</p>
      {task?<><p role="status">{task.answered} / {task.total} 題</p><ProgressBar value={task.answered/task.total*100} label="今日任務完成百分比" />
        {task.total<task.target&&<p className="study-muted">今日目標 {task.target} 題，目前依可用題目與章節分配取得 {task.total} 題。缺少題目不計零分。</p>}
        {!task.completed&&<p>今天會依你的學習狀況安排一般練習，以及需要的補強與複習內容。送出後會儲存，可隨時離開後繼續。</p>}
        {preview&&!task.completed&&<Link href="/study-plan/daily" className="study-button study-button-primary">{task.answered?'繼續今日任務':'開始今日任務'}</Link>}
        {task.completed&&<><p>今日正確：{task.correct} / {task.total}（{Math.round(task.correct!/task.total*100)}%）</p><p>已完成 {task.followUpsCompleted} 項複習追蹤。</p><p className="study-muted">今日分數只代表當日表現，章節掌握仍依既有診斷、補強與追蹤規則評估。</p>
          {!preview&&<ul>{task.summary.filter(row=>row.total>0).map(row=><li key={row.source}>{({normal:'一般練習',weakness:'補強練習',follow_up:'複習追蹤'})[row.source]}：{row.correct} / {row.total} 題正確</li>)}</ul>}
          {data.next==='reinforcement'?<Link href="/study-plan/reinforcement" className="study-button">繼續補強任務</Link>:data.next==='analysis'?<Link href="/study-plan/confirmation" className="study-button">查看目前學習建議</Link>:<p>今天的任務已完成，可以依自己的步調休息。</p>}</>}
      </>:<><p>目前沒有可用的每日題目，請稍後再試。你的學習紀錄會保留。</p>{refresh}</>}
      <details><summary>每日目標題數</summary><div className={styles.stack}><label htmlFor={preview?'daily-target-preview':'daily-target'}>每日目標（{DAILY_TARGET_MIN}～{DAILY_TARGET_MAX} 題）</label><input id={preview?'daily-target-preview':'daily-target'} type="number" min={DAILY_TARGET_MIN} max={DAILY_TARGET_MAX} value={target} onChange={event=>setTarget(event.target.value)} disabled={busy} /><button className="study-button" disabled={busy||!validDailyTarget(Number(target))||Number(target)===data.target} onClick={()=>void send('target')}>儲存每日目標</button><p className="study-muted">變更目標不會重抽今天已建立的題目。</p></div></details>
    </section>
    {preview&&!task?.completed&&data.active&&<section className={`study-card ${styles.stack}`}><h2>目前補強任務</h2><h3>{data.active.subject} → {data.active.chapter}</h3><p>{REINFORCEMENT_LABELS[data.active.status as ReinforcementStatus]}</p><Link href="/study-plan/reinforcement" className="study-button">繼續補強任務</Link><p className="study-muted">你也可以先完成今日練習。</p></section>}
    {!preview&&current&&task&&<section className={`study-card ${styles.stack}`}>
      <p className="study-muted">第 {current.position} 題</p><h2 className={quiz.question}>{current.question}</h2>
      {current.image&&<img className={styles.image} src={current.image} alt="本題附圖" /> /* eslint-disable-line @next/next/no-img-element */}
      <div className={quiz.options} role="group" aria-label="每日任務答案選項">{current.options.map((option,index)=>{if(!option.trim())return null;const letter=String.fromCharCode(65+index);return <button key={`${current.position}-${letter}`} className={`${quiz.option} ${selected===letter?quiz.selected:''}`} disabled={busy} aria-pressed={selected===letter} onClick={()=>setSelected(letter)}><span className={quiz.letter}>{letter}</span><span className={quiz.optionText}>{option}</span></button>;})}</div>
      <button className="study-button study-button-primary" disabled={busy||!selected} onClick={()=>void send('answer')}>{busy?'儲存中…':task.answered+1===task.total?'送出並完成今日任務':'送出並繼續'}</button>
    </section>}
  </div>;
}
