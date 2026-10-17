'use client';
import {useRef,useState} from 'react';
import type {QuestionHandoff,HandoffAsset} from '@/lib/explanation-handoff-input';
import {formatExamYear} from '@/lib/exam-year';
import {formatAnswer} from '@/lib/question-answer';
import styles from './questions.module.css';

export default function ExplanationExport({banks}:{banks:{id:number;name:string;visibility:string;exam_year:number|null;exam_subject:string|null;explanation_total:number}[]}){
  const [bank,setBank]=useState(''),[limit,setLimit]=useState('10'),[after,setAfter]=useState('0');
  const [year,setYear]=useState(''),[subject,setSubject]=useState(''),[numbers,setNumbers]=useState('');
  const [result,setResult]=useState<QuestionHandoff|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const lock=useRef(false);
  const eligible=banks.filter(b=>b.visibility==='public'&&b.explanation_total>0);
  const rocYear=(value:number|null)=>value===null?'unknown':String(value>=1912?value-1911:value);
  const years=[...new Set(eligible.map(b=>rocYear(b.exam_year)))].sort((a,b)=>a==='unknown'?1:b==='unknown'?-1:Number(b)-Number(a));
  const subjects=[...new Set(eligible.map(b=>b.exam_subject).filter((s):s is string=>!!s))].sort();
  const filtered=eligible.filter(b=>(!year||rocYear(b.exam_year)===year)&&(!subject||b.exam_subject===subject));
  async function preview(){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');setResult(null);
    try{
      const params=new URLSearchParams({questionSetId:bank,limit,afterId:after});
      if(numbers.trim())params.set('questionNumbers',numbers.replace(/[，、]/g,','));
      const response=await fetch(`/api/admin/questions/explanation/export?${params}`,{cache:'no-store'});
      const data=await response.json();if(!response.ok)throw Error(data.error||'匯出失敗');setResult(data);
    }catch(e){setError(e instanceof Error?e.message:'匯出失敗');}finally{lock.current=false;setBusy(false);}
  }
  function saveFile(blob:Blob,filename:string){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.click();URL.revokeObjectURL(url);}
  function download(){if(result)saveFile(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}),`vetexam-handoff-${bank}-${after}.json`);}
  async function downloadImage(asset:HandoffAsset){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try{const response=await fetch(asset.downloadUrl,{cache:'no-store'});if(!response.ok)throw Error((await response.json()).error||'原圖下載失敗');saveFile(await response.blob(),asset.filename);}
    catch(e){setError(e instanceof Error?e.message:'原圖下載失敗');}finally{lock.current=false;setBusy(false);}
  }
  function invalidate(){setResult(null);setError('');}
  return <details className={styles.card}>
    <summary className="study-button">匯出未解析國考題（ChatGPT 協作）</summary>
    <section aria-label="未解析題目匯出"><h2>可信題目匯出</h2>
      <p className={styles.muted}>僅讀取未有解析的公開國考題。預設 10 題、最多 20 題；保留原始題幹、選項與答案，不猜測來源或梯次。</p>
      <fieldset disabled={busy} className={styles.filters}>
        <label className={styles.field}>匯出年份<select aria-label="匯出年份" value={year} onChange={e=>{setYear(e.target.value);setBank('');setAfter('0');invalidate();}}><option value="">全部年份</option>{years.map(y=><option key={y} value={y}>{y==='unknown'?'年份未提供':`民國 ${y} 年`}</option>)}</select></label>
        <label className={styles.field}>匯出科目<select aria-label="匯出科目" value={subject} onChange={e=>{setSubject(e.target.value);setBank('');setAfter('0');invalidate();}}><option value="">全部科目</option>{subjects.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
        <label className={styles.field}>匯出題庫<select aria-label="匯出題庫" value={bank} onChange={e=>{setBank(e.target.value);setAfter('0');invalidate();}}><option value="">請選擇公開國考題庫</option>{filtered.map(b=><option key={b.id} value={b.id}>{formatExamYear(b.exam_year)} · {b.exam_subject||'科目未提供'} · {b.name} · #{b.id}</option>)}</select></label>
        <label className={styles.field}>指定題號（選填）<input value={numbers} maxLength={240} placeholder="例如 1,3,5（最多 20 個）" onChange={e=>{setNumbers(e.target.value);setAfter('0');invalidate();}} /></label>
        <label className={styles.field}>每批題數<input type="number" min="1" max="20" value={limit} onChange={e=>{setLimit(e.target.value);invalidate();}} /></label>
        <label className={styles.field}>從此題目 ID 之後<input type="number" min="0" max="2147483647" value={after} onChange={e=>{setAfter(e.target.value);invalidate();}} /></label>
        <button className="study-button" disabled={!filtered.some(b=>String(b.id)===bank)} onClick={preview}>讀取匯出預覽</button>
      </fieldset>
      {!filtered.length&&<p className={styles.muted}>此年份與科目沒有可選的公開國考題庫，請調整篩選。</p>}
      <p className={styles.muted}>題號以逗號分隔，留白依題目 ID 分批讀取。指定題號只在所選題庫查找，已有解析、起始 ID 之前或不存在的題目不會匯出；請核對預覽中的實際題號與題目 ID。題號重複時以題目 ID 區分，解析匯回仍須精確核對 ID 與指紋。</p>
      {busy&&<p role="status">正在讀取題目與原圖索引…</p>}{error&&<p role="alert" className={styles.warning}>{error}</p>}
      {result&&<>
        <p role="status">共 {result.questions.length} 題 · {result.assets.length} 張不重複原圖 · 匯出時間 {result.exportedAt}</p>
        <p className={styles.muted}>{result.notice}</p>
        {!result.questions.length?<p>沒有符合條件的未解析國考題，未自動補入其他題庫。</p>:<>
          <div className={styles.actions}><button className="study-button study-button-primary" onClick={download}>下載題目交接 JSON</button>{result.nextAfterId!==null&&<button className="study-button" onClick={()=>{setAfter(String(result.nextAfterId));invalidate();}}>準備下一批</button>}</div>
          <p className={styles.warning}>請下載下列每張原圖，連同 JSON 一起交給 ChatGPT。ChatGPT 無法直接開啟需要管理員登入的引用；只有 JSON 不能取代圖片。下載檔含答案，請勿公開分享。</p>
          <div className={styles.actions}>{result.assets.map(asset=><button key={asset.id} className="study-button" disabled={busy} onClick={()=>downloadImage(asset)}>下載原圖 {asset.id.slice(0,10)}</button>)}</div>
          {result.questions.map(q=><details key={q.questionId} className={styles.card}><summary>#{q.questionId} · 第 {q.questionNumber??'unknown'} 題 · {q.images.length} 張圖</summary><p className={styles.question}>{q.question}</p>{Object.entries(q.options).filter(([,v])=>v!==null&&v!=='').map(([k,v])=><p className={styles.question} key={k}>{k}. {v}</p>)}<p>題庫答案：{formatAnswer(q.officialAnswers)||'需人工核對'} · 考試梯次／官方來源／更正版本：unknown</p>{q.manualReviewReasons.map(r=><p className={styles.warningText} key={r}>{r}</p>)}</details>)}
        </>}
      </>}
    </section>
  </details>;
}
