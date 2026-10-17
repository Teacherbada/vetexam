"use client";
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {subscribeLearning} from '@/lib/learning-client';
import {COACH_NAMES} from '@/lib/coach-daily';
import {noHomeCoach,type HomeCoachSummary} from '@/lib/home-coach';
import {ProgressBar,StudyIcon} from './StudyUI';
import styles from './home-coach.module.css';

export default function HomeCoachCard({initial,owner}:{initial:HomeCoachSummary;owner:string|null|undefined}){
 const [data,setData]=useState(initial),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const [confirmedOwner,setConfirmedOwner]=useState(owner);
 if(owner!==undefined&&owner!==confirmedOwner)setConfirmedOwner(owner);
 // undefined means session hydration is pending. Never render one account's
 // data for another resolved identity; nothing is persisted in browser storage.
 const displayOwner=owner===undefined?confirmedOwner:owner;
 const visible=data.enabled&&(displayOwner===undefined?data.owner===initial.owner:displayOwner===data.owner);
 useEffect(()=>{
  const id=owner;
  if(!id)return;
  let active=true,controller:AbortController|null=null,queued=false,debounce:ReturnType<typeof setTimeout>|undefined;
  async function refresh(){
   if(controller){queued=true;return;}
   controller=new AbortController();const signal=controller.signal;
   const timeout=setTimeout(()=>controller?.abort(),12000);
   try{
    const read=async(method:string)=>{
     const response=await fetch('/api/study-plan/home',{method,cache:'no-store',signal});
     if(response.status===401)return noHomeCoach;
     const body=await response.json();if(!response.ok)throw Error(body.error||'今日教練暫時無法更新。');
     if(body.owner!==id||typeof body.enabled!=='boolean')throw Error('無法確認教練資料，請重新載入。');
     return body as HomeCoachSummary;
    };
    let next=await read('GET');
    if(next.enabled&&!next.task)next=await read('POST');
    if(active){setData(next);setError('');}
   }catch{if(active)setError('進度暫時無法更新，顯示上次讀取結果。');}
   finally{clearTimeout(timeout);controller=null;if(active&&queued){queued=false;void refresh();}}
  }
  const schedule=()=>{clearTimeout(debounce);debounce=setTimeout(()=>{if(document.visibilityState==='visible')void refresh();},200);};
  // A server snapshot is already current. Only bootstrap missing assignments
  // or a changed identity; no duplicate homepage read on normal hydration.
  if(retry||id!==initial.owner||(initial.enabled&&!initial.task))void refresh();
  const unsubscribe=subscribeLearning(schedule);
  window.addEventListener('focus',schedule);window.addEventListener('pageshow',schedule);document.addEventListener('visibilitychange',schedule);
  // Taipei has no DST. Refresh exactly at its next midnight, then daily.
  let midnight:ReturnType<typeof setTimeout>;
  const nextDay=()=>{const now=Date.now();midnight=setTimeout(()=>{schedule();nextDay();},86400000-((now+8*3600000)%86400000)+100);};nextDay();
  return()=>{active=false;clearTimeout(debounce);clearTimeout(midnight);controller?.abort();unsubscribe();window.removeEventListener('focus',schedule);window.removeEventListener('pageshow',schedule);document.removeEventListener('visibilitychange',schedule);};
 },[owner,initial,retry]);
 if(!visible)return null;
 const task=data.task,compact=task?.compact?.enabled?task.compact:null;
 const next=task?.groups.find(g=>g.remaining>0);
 const href=data.diagnostic?'/study-plan/diagnostic':compact?'/study-plan/daily?task=busy':next?'/study-plan/daily?task='+next.key:'/study-plan/daily';
 const done=compact?compact.completed:task?.completed;
 return <section className={`study-card ${styles.card}`} aria-labelledby="home-coach-title" data-home-coach>
  <div className={styles.heading}><div><p className="study-muted">{data.date} · 今日訓練</p><h2 id="home-coach-title"><StudyIcon name="target" />今日國考教練</h2></div><Link href="/study-plan" className="study-text-link">調整計畫<StudyIcon name="calendar" /></Link></div>
  <div className={styles.body}>
   <div className={styles.progress}>
    <p className={styles.count}>{task?<>已完成 <strong>{task.answered}</strong> 題 · 尚未完成 <strong>{task.remaining}</strong> 題</>:data.diagnostic?<>初始能力診斷：{data.diagnostic.answered} / {data.diagnostic.total} 題</>:'正在準備今日訓練…'}</p>
    <ProgressBar value={task?.total?task.answered/task.total*100:0} label="首頁教練任務完成百分比" />
    <p className="study-muted">今日總練習 {data.todayTotal??0} 題（含自由練習）{task?` · 指定複習 ${task.review.answered} / ${task.review.total} 題`:''}</p>
    {compact&&<p className="study-muted">精簡訓練 {compact.answered} / {compact.total} 題；原計畫完整保留。</p>}
    {done&&<p>{compact?'今日精簡訓練完成':'今日教練任務完成'}，查看成果與下一步建議。</p>}
    {task&&task.total===0&&<p>目前沒有可安排的題目，請查看今日任務說明。</p>}
    {task&&task.total>0&&task.total<(data.target??0)&&<p className="study-muted">依可用題庫安排 {task.total} 題（目標 {data.target} 題）。</p>}
   </div>
   <div className={styles.tasks}>
    {task?.groups.map(g=><Link key={g.key} href={'/study-plan/daily?task='+g.key} className={styles.task}><span>{COACH_NAMES[g.key]}</span><span>{g.answered} / {g.total} 題<StudyIcon name={g.total>0&&!g.remaining?'check':'arrow'} /></span></Link>)}
    {!task&&<p className="study-muted">{data.diagnostic?'目前正在建立你的學習分析，先完成診斷再安排個人化訓練。':'會依已保存的學習紀錄安排，重新整理不會重置進度。'}</p>}
   </div>
  </div>
  <div className={styles.actions}><Link href={href} className="study-button study-button-primary">{done?'查看訓練成果':data.diagnostic?'開始或繼續診斷':'繼續練習'}<StudyIcon name="arrow" /></Link><span className="study-muted">送出答案後才計入對應任務。</span></div>
  {error&&<p role="alert">{error} <button className="study-text-link" onClick={()=>setRetry(n=>n+1)}>重新載入</button></p>}
 </section>;
}
