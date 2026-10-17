'use client';
import Link from 'next/link';
import {ProgressBar} from '@/components/dashboard/StudyUI';
import OfficialExplanation from '@/components/questions/OfficialExplanation';
import {formatAnswer} from '@/lib/question-answer';
import {COACH_NAMES,type CoachGroup,type CoachFeedback} from '@/lib/coach-daily';
import type {DailyView} from '@/lib/daily-task';
import styles from './coach-today.module.css';
import quiz from '@/app/questions/quiz.module.css';
function Feedback({value}:{value:CoachFeedback}){return <div className={styles.stack}>
 <p>{value.comment}</p><p>本次正確率：{value.accuracy??'—'}%</p>
 {value.strong.length>0&&<div><h3>本次表現較佳的範圍</h3><ul>{value.strong.map(s=><li key={s}>{s}</li>)}</ul></div>}
 {value.revisit.length>0&&<div><h3>下次需要再確認</h3><ul>{value.revisit.map(s=><li key={s}>{s}</li>)}</ul><p className="study-muted">少量錯題只作複習線索，不直接認定為弱點。</p></div>}
 <p>{value.next}</p>
</div>;}
type Props={data:DailyView;preview:boolean;group:CoachGroup|null;onGroup:(g:CoachGroup)=>void;busy:boolean;selected:string;onSelect:(s:string)=>void;onAnswer:()=>void};
export default function CoachToday({data,preview,group,onGroup,busy,selected,onSelect,onAnswer}:Props){
 const coach=data.coach!,task=data.task,active=coach.groups.find(g=>g.key===group)??coach.groups.find(g=>g.current)??coach.groups.find(g=>g.total),current=active?.current;
 if(coach.diagnostic)return <section className={`study-card ${styles.stack}`}>
  <p className="study-muted">{data.date} · 台北時間</p><h2>今天，先讓教練了解你</h2>
  <p>目前正在建立你的學習分析。先完成初始能力診斷，再安排有依據的弱點特訓與複習。</p>
  <p>{coach.diagnostic.total?`已儲存 ${coach.diagnostic.answered} / ${coach.diagnostic.total} 題，可接續上次進度。`:'使用現有六科診斷題目，題量不足時依實際題數進行。'}</p>
  <Link href="/study-plan/diagnostic" className="study-button study-button-primary">{coach.diagnostic.total?'繼續初始能力診斷':'開始初始能力診斷'}</Link>
 </section>;
 return <div className={styles.stack}>
  <section className={`study-card ${styles.stack}`}>
   <p className="study-muted">{data.date} · 台北時間</p><h2>{task?.completed?'今天的訓練完成了':'歡迎回來，今天一起穩定練習'}</h2>
   <p>{task?.completed?'先看今天的結果，再決定下次複習方向。':'從下方任務選一項開始；每題送出後保存至帳號，中途離開也能繼續。'}</p>
   {task?<><p role="status">今日已儲存 {task.answered} / {task.total} 題</p><ProgressBar value={task.total?task.answered/task.total*100:0} label="今日教練任務完成百分比" />
    {task.total<task.target&&<p className="study-muted">設定目標 {task.target} 題，可用題庫實際安排 {task.total} 題；不重複湊題，也不將缺題計為零分。</p>}
    {preview&&!task.completed&&!coach.legacy&&<Link href={'/study-plan/daily?task='+(coach.groups.find(g=>g.current)?.key??'challenge')} className="study-button study-button-primary">{task.answered?'繼續今日訓練':'開始今日訓練'}</Link>}
    {coach.legacy&&<><p>保留今天原有的任務與作答順序，三類任務會從下一次新建日程開始使用。</p><Link href="/study-plan/daily" className="study-button study-button-primary">繼續今日任務</Link></>}
   </>:<p role="status">目前沒有可用的正式國考題目。紀錄已保留，請稍後重試；不會補入獸醫練功房題目。</p>}
  </section>
  {preview&&<div className={styles.cards} aria-label="今日三項訓練">{coach.groups.map(g=><section className={`study-card ${styles.stack}`} key={g.key}>
   <h3>{COACH_NAMES[g.key]}</h3><p>{g.total?`${g.answered} / ${g.total} 題 · ${g.completed?'已完成':g.answered?'進行中':'待練習'}`:'今日未安排'}</p>
   <p>{g.reason}</p>
   {g.focus.length>0&&<details><summary>科目與章節（{g.focus.length} 個範圍）</summary><ul>{g.focus.map(s=><li key={s}>{s}</li>)}</ul></details>}
   {g.repeated>0&&<p className="study-muted">含 {g.repeated} 題近期曾練習的原題，請以理解作答。</p>}
   {g.total>0&&(preview?<Link className="study-button study-button-primary" href={'/study-plan/daily?task='+g.key}>{g.completed?'查看結果':g.answered?'繼續':'開始'}{COACH_NAMES[g.key]}</Link>:<button className="study-button" disabled={busy} onClick={()=>onGroup(g.key)}>{g.completed?'查看結果':g.answered?'繼續':'開始'}{COACH_NAMES[g.key]}</button>)}
  </section>)}</div>}
  {!preview&&active&&<section className={`study-card ${styles.stack}`}>
   <div className={styles.switcher} aria-label="切換訓練任務">{coach.groups.filter(g=>g.total).map(g=><button className="study-button" key={g.key} disabled={busy} aria-pressed={g.key===active.key} onClick={()=>onGroup(g.key)}>{COACH_NAMES[g.key]} {g.answered}/{g.total}</button>)}</div>
   <h2>{COACH_NAMES[active.key]}{active.completed?'完成':''}</h2>
   {current?<><p className="study-muted">本任務第 {active.answered+1} / {active.total} 題</p><h3 className={quiz.question}>{current.question}</h3>
    {current.image&&<img className={styles.image} src={current.image} alt="本題附圖" /> /* eslint-disable-line @next/next/no-img-element */}
    <div className={quiz.options} role="group" aria-label="每日任務答案選項">{current.options.map((text,i)=>{const letter=String.fromCharCode(65+i);return text.trim()?<button className={`${quiz.option} ${selected===letter?quiz.selected:''}`} key={letter} disabled={busy} aria-pressed={selected===letter} onClick={()=>onSelect(letter)}><span className={quiz.letter}>{letter}</span><span className={quiz.optionText}>{text}</span></button>:null;})}</div>
    <button className="study-button study-button-primary" disabled={busy||!selected} onClick={onAnswer}>{busy?'儲存中…':active.answered+1===active.total?'送出並查看任務回饋':'送出並繼續'}</button>
   </>:active.feedback&&<><Feedback value={active.feedback}/><details><summary>本次答案與已發布解析</summary>{data.receipts.filter(r=>active.positions.includes(r.position??-1)).map(r=><div className={styles.receipt} key={r.eventId}><h3>{r.question}</h3><p>你的答案：{r.userAnswer} · 官方答案：{formatAnswer(r.answer)} · {r.correct?'正確':'待複習'}</p>{r.explanation?<><h4>VetExam 精選解析</h4><OfficialExplanation content={r.explanation}/></>:<p className="study-muted">尚無已發布解析。</p>}</div>)}</details></>}
  </section>}
  {coach.feedback&&<section className={`study-card ${styles.stack}`}><h2>今日成果與明日方向</h2><Feedback value={coach.feedback}/></section>}
  {preview&&<section className={`study-card ${styles.stack}`}><h2>本週學習概況</h2><p>台北時間週一至今：練習 {coach.week.days} 天，完成 {coach.week.answered} 題今日任務，答對 {coach.week.correct} 題。</p><p className="study-muted">僅統計每日教練任務，不重複加計其他練習。</p></section>}
 </div>;
}
