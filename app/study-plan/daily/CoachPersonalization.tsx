'use client';
import {useEffect,useRef,useState} from 'react';
import {EXAM_SUBJECTS} from '@/data/exam-chapters';
import type {CoachReport} from '@/lib/coach-personalization';
import styles from './coach-today.module.css';

export default function CoachPersonalization({date}:{date:string}) {
 const [open,setOpen]=useState(false),[data,setData]=useState<CoachReport|null>(null),[focus,setFocus]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
 const lock=useRef(false);
 useEffect(()=>{if(!open)return;const controller=new AbortController();
  void fetch('/api/study-plan/coach',{cache:'no-store',signal:controller.signal}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.error);if(!controller.signal.aborted){setData(body);setFocus(body.focus??'');setError('');}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
  return()=>controller.abort();
 },[open,date,reload]);
 async function save(){if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');
  try{const response=await fetch('/api/study-plan/coach',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({subject:focus||null})}),body=await response.json();if(!response.ok)throw Error(body.error);setData(old=>old?{...old,focus:body.focus}:old);setNotice('本週偏好已儲存。今天的題目不重抽，從下一個新建日程生效；下週自動交給教練安排。');}
  catch(e){setError(e instanceof Error?e.message:'儲存失敗，請重試。');}finally{lock.current=false;setBusy(false);}
 }
 return <section className={`study-card ${styles.stack}`}>
  <details open={open} onToggle={e=>{setOpen(e.currentTarget.open);if(e.currentTarget.open){setError('');setData(null);}}}><summary>本週重點與學習週報</summary>
   <div className={styles.stack}>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!data&&!error&&<p role="status">讀取本週實際紀錄中…</p>}
    <button className="study-button" disabled={busy} onClick={()=>{setError('');setData(null);setReload(v=>v+1);}}>重新讀取週報與偏好</button>
    {data&&<>
     <label htmlFor="coach-week-focus">本週想優先加強的科目</label>
     <select id="coach-week-focus" value={focus} disabled={busy} onChange={e=>setFocus(e.target.value)}><option value="">交給教練安排</option>{EXAM_SUBJECTS.map(s=><option key={s} value={s}>{s}</option>)}</select>
     <button className="study-button" disabled={busy||focus===(data.focus??'')} onClick={()=>void save()}>{busy?'儲存中…':'儲存本週重點'}</button>
     <p className="study-muted">偏好只影響部分綜合挑戰題數；到期複習與實際弱點優先，其他科目仍會出現。</p>
     <h3>本週成果（{data.week} 起，台北時間）</h3>
     <p>完成 {data.weekStats.answered} 題，答對 {data.weekStats.correct} 題；完成訓練 {data.weekStats.completedDays} 天（正常或精簡版完成皆計一天）。</p>
     <p>已安排複習完成：{data.weekStats.reviewTotal?`${data.weekStats.reviewDone} / ${data.weekStats.reviewTotal} 題（${Math.round(100*data.weekStats.reviewDone/data.weekStats.reviewTotal)}%）`:'本週尚未安排複習題目'}</p>
     <h3>可比較的正確率變化</h3>
     {!data.trends.length?<p>目前沒有足夠的可比樣本，暫不判定進步。每章節須有至少 5 道兩週都作答的相同題目。</p>:<ul>{data.trends.map(t=><li key={t.subject+t.chapter}>{t.subject}－{t.chapter}：{t.count} 道相同題目，{Math.round(100*t.before/t.count)}% → {Math.round(100*t.after/t.count)}%（{t.change>0?'+':''}{t.change} 個百分點）</li>)}</ul>}
     <p className="study-muted">比較本週至今與上週相同天數、同章節相同題目的最後一次教練作答；可能包含記住原題的效果，不能等同觀念精熟。</p>
     <h3>仍需加強的章節</h3>{data.weak.length?<ul>{data.weak.map(t=><li key={t.subject+t.chapter}>{t.subject}－{t.chapter}：近 30 天 {t.count} 道不同題目，答對 {t.correct} 題，{t.repeated} 題曾重複答錯。</li>)}</ul>:<p>尚無樣本足夠且達弱點門檻的章節。</p>}
     <h3>本次比較表現改善的章節</h3>{data.trends.some(t=>t.change>0)?<ul>{data.trends.filter(t=>t.change>0).map(t=><li key={t.subject+t.chapter}>{t.subject}－{t.chapter}：增加 {t.change} 個百分點，仍需後續不同題目確認。</li>)}</ul>:<p>尚無足夠證據列出改善章節。</p>}
     <h3>到期章節複習</h3>{data.due.length?<ul>{data.due.slice(0,5).map(r=><li key={r.subject+r.chapter}>{r.subject}－{r.chapter} · {r.due} 到期{r.lapses?' · 延遲確認時曾再次答錯':''}</li>)}</ul>:<p>目前沒有到期章節；首次答錯隔天確認，答對後依序延長至 3、7、14、30 天。</p>}
     {data.upcoming.length>0&&<><h3>下一次章節確認</h3><ul>{data.upcoming.map(r=><li key={r.subject+r.chapter}>{r.due}：{r.subject}－{r.chapter}</li>)}</ul></>}
     <p className="study-muted">排程追蹤教練作答；一般練習維持原有記憶機制。章節只是複習範圍，不代表所有題目都是相同考點。</p>
    </>}
   </div>
  </details>
 </section>;
}
