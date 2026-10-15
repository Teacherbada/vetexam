'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import AdminShell from '@/components/ui/AdminShell';
import ImageViewer from '@/components/ui/ImageViewer';
import OfficialExplanation from '@/components/questions/OfficialExplanation';
import {formatExamYear} from '@/lib/exam-year';
import {answerKeys,formatAnswer,serializeAnswer} from '@/lib/question-answer';
import {questionIssues,PROOF_BODY_LIMIT,type ImageInput} from '@/lib/question-proofreading-input';
import type {proofBank,proofDetail} from '@/lib/question-proofreading';
import base from '../questions.module.css';
import styles from './proofread.module.css';

type BankData=Awaited<ReturnType<typeof proofBank>>;
type Detail=Awaited<ReturnType<typeof proofDetail>>;
type Bank={id:number;name:string;exam_year:number|null;exam_subject:string;count:number};
type Picture={input:ImageInput;url:string};
type Draft={question:string;options:string[];answer:string;explanation:string;images:Picture[]};
type History={id:number;actor_id:string;created_at:string;action:string;changed_fields:string[];before:Record<string,unknown>;after:Record<string,unknown>;detailed?:boolean};
const endpoint='/api/admin/questions/proofread';
async function request<T>(suffix:string,body?:unknown):Promise<T>{
  const r=await fetch(endpoint+suffix,{cache:'no-store',...(body?{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  let d;try{d=await r.json();}catch{throw Error(`伺服器回應失敗（${r.status}），尚未確認儲存成功，請保留內容重試。`);}
  if(!r.ok)throw Error(d.error||'操作失敗');return d;
}
const draftOf=(q:Detail):Draft=>({question:q.question,options:[...q.options],answer:q.answer,explanation:q.explanation,images:q.images.map(i=>({input:{questionId:i.questionId,index:i.index,revision:i.revision},url:i.url}))});
export default function Proofreading(){
  const [banks,setBanks]=useState<Bank[]>([]),[bankId,setBankId]=useState(''),[bank,setBank]=useState<BankData|null>(null);
  const [selected,setSelected]=useState<Detail|null>(null),[draft,setDraft]=useState<Draft|null>(null),[dirty,setDirty]=useState(false);
  const [mode,setMode]=useState<'edit'|'paper'>('edit'),[preview,setPreview]=useState(false),[filter,setFilter]=useState('all'),[number,setNumber]=useState('');
  const [year,setYear]=useState(''),[subject,setSubject]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[confirmAnswer,setConfirmAnswer]=useState(false),[confirmExplanation,setConfirmExplanation]=useState(false),[recalculate,setRecalculate]=useState(false);
  const [history,setHistory]=useState<History[]>([]),[failedImages,setFailedImages]=useState<number[]>([]),[attachId,setAttachId]=useState(''),[attach,setAttach]=useState<Detail|null>(null);
  const operation=useRef(false),dirtyRef=useRef(false),loadSequence=useRef(0),requestId=useRef(''),paperPosition=useRef(0);
  useEffect(()=>{request<{banks:Bank[]}>('').then(d=>{setBanks(d.banks);const id=new URLSearchParams(location.search).get('bankId');if(id&&d.banks.some(b=>b.id===Number(id)))void chooseBank(id,true);}).catch(e=>setError(e.message));},[]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{dirtyRef.current=dirty;},[dirty]);
  useEffect(()=>{
    const unload=(e:BeforeUnloadEvent)=>{if(dirtyRef.current){e.preventDefault();e.returnValue='';}};
    const link=(e:MouseEvent)=>{const anchor=(e.target as Element)?.closest?.('a[href]');if(anchor&&dirtyRef.current&&!confirm('尚有未儲存修改，確定離開？')){e.preventDefault();e.stopPropagation();}};
    window.addEventListener('beforeunload',unload);document.addEventListener('click',link,true);
    return()=>{window.removeEventListener('beforeunload',unload);document.removeEventListener('click',link,true);};
  },[]);
  function canLeave(){return !dirtyRef.current||confirm('尚有未儲存修改，確定捨棄並切換？');}
  function accept(q:Detail){setSelected(q);setDraft(draftOf(q));setDirty(false);dirtyRef.current=false;setConfirmAnswer(false);setConfirmExplanation(false);setRecalculate(false);setPreview(false);setHistory([]);setAttach(null);setAttachId('');setFailedImages(ids=>ids.filter(id=>id!==q.id));requestId.current=crypto.randomUUID();}
  function edit(patch:Partial<Draft>){setDraft(d=>d?{...d,...patch}:d);setDirty(true);dirtyRef.current=true;setNotice('');setConfirmAnswer(false);setConfirmExplanation(false);setRecalculate(false);requestId.current=crypto.randomUUID();}
  async function open(id:number,force=false){if(operation.current||!force&&!canLeave())return;const seq=++loadSequence.current;setLoading(true);setError('');
    try{const q=await request<Detail>('?id='+id);if(seq===loadSequence.current){accept(q);setMode('edit');}}
    catch(e){if(seq===loadSequence.current)setError((e as Error).message);}finally{if(seq===loadSequence.current)setLoading(false);}}
  async function chooseBank(id:string,force=false){if(operation.current||!force&&!canLeave())return;loadSequence.current++;setBankId(id);setBank(null);setSelected(null);setDraft(null);setDirty(false);dirtyRef.current=false;setHistory([]);setFailedImages([]);setAttach(null);setAttachId('');setError('');if(!id)return;setLoading(true);
    try{const result=await request<BankData>('?bankId='+id);setBank(result);const qid=Number(new URLSearchParams(location.search).get('questionId'));const q=result.questions.find(q=>q.id===qid)||result.questions[0];if(q)await open(q.id,true);}
    catch(e){setError((e as Error).message);}finally{setLoading(false);}}
  async function refreshBank(){if(bankId)setBank(await request<BankData>('?bankId='+bankId));}
  const visible=bank?.questions.filter(q=>(!number||String(q.number)===number)&&(filter==='all'||filter==='pending'&&!q.reviewed||filter==='reviewed'&&q.reviewed||filter==='abnormal'&&(q.issues.length||failedImages.includes(q.id))||filter==='image'&&q.hasImage))??[];
  const index=bank?.questions.findIndex(q=>q.id===selected?.id)??-1;
  function move(delta:number){const q=bank?.questions[index+delta];if(q)void open(q.id);}
  function paper(){if(!canLeave())return;setDirty(false);dirtyRef.current=false;if(selected)setDraft(draftOf(selected));setMode('paper');requestAnimationFrame(()=>window.scrollTo(0,paperPosition.current));}
  function reorder(from:number,to:number){if(!draft||to<0||to>=draft.options.length)return;const options=[...draft.options];[options[from],options[to]]=[options[to],options[from]];edit({options,answer:''});}
  function removeOption(index:number){if(!draft||draft.options.length<=2)return;edit({options:draft.options.filter((_,i)=>i!==index),answer:''});}
  async function upload(files:FileList|null,replace?:number){if(!files||!draft||operation.current)return;operation.current=true;setBusy(true);setDirty(true);dirtyRef.current=true;setError('');try{
    const images=[...draft.images];for(const file of Array.from(files)){
      if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2*1024*1024)throw Error('請選擇 2 MB 以內的 PNG、JPEG 或 WebP');
      const url=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('圖片讀取失敗'));reader.readAsDataURL(file);});
      const picture={input:{dataUrl:url},url};if(replace!==undefined)images[replace]=picture;else images.push(picture);
    }if(images.length>8)throw Error('每題最多 8 張圖片');edit({images});
  }catch(e){setError((e as Error).message);}finally{operation.current=false;setBusy(false);}}
  async function execute(action:string,extra:Record<string,unknown>={},next=false){if(operation.current||!selected)return;operation.current=true;setBusy(true);setError('');setNotice('');const previousId=selected.id;
    const payload={action,id:selected.id,revision:selected.revision,requestId:requestId.current||crypto.randomUUID(),...extra};
    try{
      if(new TextEncoder().encode(JSON.stringify(payload)).length>PROOF_BODY_LIMIT)throw Error('本次圖片資料過大，請分次上傳或縮小圖片');
      const result=await request<{question:Detail;replayed?:boolean}>('',payload);accept(result.question);
      // A refresh failure must not disguise a successful save.
      try{await refreshBank();}catch{setError('本題已儲存，但總覽更新失敗，請重新載入總覽。');}
      setNotice(action==='review'?'已記錄人工核對':action==='unreview'?'已改為待核對':action==='restore'?'已回復單題內容，請重新核對；解析保留為草稿':'已儲存，題目已改為待核對；解析保留為草稿');
      if(next){const i=bank?.questions.findIndex(q=>q.id===previousId)??-1;const target=bank?.questions[i+1];if(target){operation.current=false;await open(target.id,true);}}
    }catch(e){setError((e as Error).message);}finally{operation.current=false;setBusy(false);}}
  function save(next=false){if(!draft)return;void execute('save',{question:draft.question,options:draft.options,answer:draft.answer,explanation:draft.explanation,images:draft.images.map(i=>i.input),confirmAnswer,confirmExplanation,recalculateStats:recalculate},next);}
  function review(){if(!selected||dirty)return;const warnings=selected.issues.length||failedImages.includes(selected.id);if(warnings&&!confirm('本題有異常提示。請確認已逐項對照官方原題；確定標記人工核對？'))return;requestId.current=crypto.randomUUID();void execute(selected.reviewed?'unreview':'review',{confirmWarnings:true});}
  async function complete(){if(!bank||operation.current||!canLeave())return;if(!confirm('確認已按官方原始考卷檢查題數、題號、所有題目及圖片？'))return;operation.current=true;setBusy(true);setError('');try{const r=await request<{bank:BankData}>('',{action:'complete',bankId:bank.bank.id,revision:bank.revision});setBank(r.bank);setNotice('已確認整卷校對完成。此狀態不會發布精選解析。');}catch(e){setError((e as Error).message);}finally{operation.current=false;setBusy(false);}}
  function markBroken(id:number){setFailedImages(ids=>ids.includes(id)?ids:[...ids,id]);}
  const optionsChanged=!!selected&&!!draft&&JSON.stringify(selected.options)!==JSON.stringify(draft.options);
  const answerChanged=!!selected&&!!draft&&serializeAnswer(selected.answer,true)!==serializeAnswer(draft.answer,true);
  const issues=draft?questionIssues(draft):[];
  return <AdminShell title="題庫校對工作台" current="/admin/questions" description="按原題號校對，保留原題 ID 與歷史紀錄。">
    <div className={styles.toolbar}><Link className="study-button" href="/admin/questions">返回題目維護中心</Link>{bank&&<><button className="study-button" disabled={busy} onClick={()=>{if(mode==='paper'&&selected)void open(selected.id);else paper();}}>{mode==='paper'?'單題編輯模式':'返回整份考卷'}</button><span>{dirty?'有未儲存修改':'內容已載入'}</span></>}</div>
    {error&&<p role="alert" className={base.warning}>{error}</p>}{notice&&<p role="status" className={base.success}>{notice}</p>}
    <section className={base.card}><fieldset disabled={busy||loading} className={base.filters}>
      <label className={base.field}>年份<select value={year} onChange={e=>setYear(e.target.value)}><option value="">全部年份</option>{[...new Set(banks.map(b=>b.exam_year))].map(y=><option key={y??'none'} value={y??'none'}>{formatExamYear(y)}</option>)}</select></label>
      <label className={base.field}>科目<select value={subject} onChange={e=>setSubject(e.target.value)}><option value="">全部科目</option>{[...new Set(banks.map(b=>b.exam_subject))].map(s=><option key={s}>{s}</option>)}</select></label>
      <label className={base.field}>考卷<select aria-label="考卷" value={bankId} onChange={e=>void chooseBank(e.target.value)}><option value="">請選擇考卷</option>{banks.filter(b=>(!year||String(b.exam_year??'none')===year)&&(!subject||b.exam_subject===subject)||String(b.id)===bankId).map(b=><option key={b.id} value={b.id}>{b.name} · #{b.id} · {b.count} 題</option>)}</select></label>
      <label className={base.field}>篩選<select aria-label="篩選" value={filter} onChange={e=>setFilter(e.target.value)}>{[['all','全部題目'],['pending','待核對'],['reviewed','已核對'],['abnormal','異常題目'],['image','有圖片題目']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
    </fieldset>{bank&&<><p>總題數：{bank.summary.total}／原卷設定 {bank.bank.total_questions} · 已核對：{bank.summary.reviewed} · 待核對：{bank.summary.pending} · 異常題目：{bank.summary.abnormal}</p>
      <p className={styles.muted}>{bank.completed?'已人工確認整卷完成':'整卷尚未確認完成'} · 系統未偵測異常，不代表已人工核對。</p>
      {!bank.numbering.valid&&<p className={base.warning}>題數或題號不完整。缺漏：{bank.numbering.missing.join('、')||'無'}；重複：{bank.numbering.duplicate.join('、')||'無'}。本工作台不會自動改題號或補題。</p>}
      <button className="study-button" disabled={busy||bank.summary.pending>0||!bank.numbering.valid||!!failedImages.length||bank.completed} onClick={()=>void complete()}>確認整卷校對完成</button></>}
    </section>
    {loading&&<p role="status">正在載入題目…</p>}
    {bank&&<div className={styles.layout}><aside className={`${base.card} ${styles.nav}`}><label className={base.field}>題號搜尋<input type="search" inputMode="numeric" value={number} onChange={e=>setNumber(e.target.value.replace(/\D/g,''))}/></label>
      <div className={styles.grid} aria-label="題號導航">{visible.map(q=><button key={q.id} disabled={busy} aria-current={selected?.id===q.id} data-reviewed={q.reviewed} data-issue={!!q.issues.length||failedImages.includes(q.id)} title={`ID ${q.id} · ${q.reviewed?'已核對':'待核對'}${q.issues.length?' · 異常':''}`} onClick={()=>{if(mode==='paper')document.getElementById('proof-'+q.id)?.scrollIntoView();else void open(q.id);}}>{q.number}{q.reviewed?' ✓':q.issues.length?' !':''}</button>)}</div>{!visible.length&&<p>沒有符合的題目。</p>}</aside>
    <div className={styles.panel}>{mode==='paper'?<div role="region" className={styles.paper} aria-label="整卷校對模式">{visible.map(q=><article id={'proof-'+q.id} key={q.id} className={base.card}><div className={styles.toolbar}><h2>第 {q.number} 題 · ID {q.id}</h2><span>{q.reviewed?'已核對':'待核對'}</span><button className="study-button" disabled={busy} onClick={()=>{paperPosition.current=window.scrollY;void open(q.id);}}>編輯題目 {q.number}</button></div>
      <p>{q.question||'題幹空白'}</p>{q.options.map((o,i)=><p key={i}>{String.fromCharCode(65+i)}. {o||'（空白）'}</p>)}<p>官方答案：{formatAnswer(q.answer)||'尚未設定'}</p>
      {!!q.issues.length&&<ul className={base.warning}>{q.issues.map(s=><li key={s}>{s}</li>)}</ul>}
      {q.hasImage&&<details onErrorCapture={()=>markBroken(q.id)}><summary>查看圖片（{q.imageCount} 張）</summary><div className={styles.images}>{Array.from({length:q.imageCount},(_,i)=><ImageViewer key={i} src={`${endpoint}?id=${q.id}&image=${i}&revision=${q.revision}`} alt={`第 ${q.number} 題原圖 ${i+1}`}/>)}</div></details>}
      {q.explanation&&<details><summary>精選解析 · {q.explanationStatus==='published'?'已發布':'草稿'}</summary><OfficialExplanation content={q.explanation}/></details>}
    </article>)}</div>:selected&&draft&&<section className={base.card} aria-label="題目完整編輯"><div className={styles.toolbar}><h2>第 {selected.number} 題 · ID {selected.id}</h2><span>{selected.reviewed?'已核對':'待核對'}</span><button className="study-button" disabled={busy||dirty||failedImages.includes(selected.id)} onClick={review}>{selected.reviewed?'改為待核對':'標記已核對'}</button><button className="study-button" disabled={busy} onClick={()=>setPreview(v=>!v)}>{preview?'返回編輯':'預覽題目'}</button></div>
      <fieldset disabled={busy||loading}>
      {preview?<div aria-label="題目預覽"><p className={styles.text}>{draft.question}</p>{draft.options.map((o,i)=><p key={i} className={styles.text}>{String.fromCharCode(65+i)}. {o}</p>)}<p>官方答案：{formatAnswer(draft.answer)||'尚未設定'}</p><div className={styles.images}>{draft.images.map((i,n)=><ImageViewer key={n} src={i.url} alt={`題目預覽圖片 ${n+1}`}/>)}</div><OfficialExplanation content={draft.explanation}/></div>:<>
      <label className={base.field}>題幹<textarea aria-label="題幹" rows={5} maxLength={20000} value={draft.question} onChange={e=>edit({question:e.target.value})}/></label>
      <h3>選項</h3>{draft.options.map((o,i)=><div key={i} className={styles.option}><strong>{String.fromCharCode(65+i)}</strong><textarea aria-label={`選項 ${String.fromCharCode(65+i)}`} value={o} maxLength={10000} onChange={e=>edit({options:draft.options.map((v,n)=>n===i?e.target.value:v)})}/><div className={styles.optionActions}><button type="button" className="study-button" disabled={i===0} onClick={()=>reorder(i,i-1)}>上移 {String.fromCharCode(65+i)}</button><button type="button" className="study-button" disabled={i===draft.options.length-1} onClick={()=>reorder(i,i+1)}>下移 {String.fromCharCode(65+i)}</button><button type="button" className="study-button" disabled={draft.options.length<=2} onClick={()=>removeOption(i)}>刪除 {String.fromCharCode(65+i)}</button></div></div>)}
      <button type="button" className="study-button" disabled={draft.options.length>=5} onClick={()=>edit({options:[...draft.options,'']})}>新增選項</button><p className={styles.muted}>沿用 A–E 欄位，支援 2～5 個選項。刪除或重排後清空答案，請重新指定。</p>
      <h3>官方接受答案</h3><div className={styles.choices}>{draft.options.map((_,i)=>{const letter=String.fromCharCode(65+i);return <label key={letter}><input type="checkbox" checked={answerKeys(draft.answer).includes(letter)} onChange={e=>{const keys=answerKeys(draft.answer).filter(k=>k!==letter);if(e.target.checked)keys.push(letter);edit({answer:serializeAnswer(keys,true)||''});}}/>{letter}</label>;})}</div><p className={styles.muted}>學生仍只選一個；任一官方接受答案即算正確。</p>
      <details open={draft.images.length>0} onErrorCapture={()=>markBroken(selected.id)}><summary>題目圖片（{draft.images.length} 張）</summary><div className={styles.images}>{draft.images.map((image,i)=><div className={styles.image} key={i}><ImageViewer src={image.url} alt={`第 ${selected.number} 題圖片 ${i+1}`}/><div className={styles.toolbar}><button type="button" className="study-button" onClick={()=>edit({images:draft.images.filter((_,n)=>n!==i)})}>移除圖片 {i+1}</button><button type="button" className="study-button" disabled={i===0} onClick={()=>{const a=[...draft.images];[a[i-1],a[i]]=[a[i],a[i-1]];edit({images:a});}}>上移圖片 {i+1}</button><label>替換圖片 {i+1}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{void upload(e.target.files,i);e.target.value='';}}/></label></div></div>)}</div>
      <label className={base.field}>新增圖片<input type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={e=>{void upload(e.target.files);e.target.value='';}}/></label>
      <details><summary>附加本卷其他題目的原圖</summary><label className={base.field}>來源題目<select value={attachId} onChange={async e=>{setAttachId(e.target.value);setAttach(null);if(e.target.value)try{setAttach(await request<Detail>('?id='+e.target.value));}catch(err){setError((err as Error).message);}}}><option value="">選擇有圖片的題目</option>{bank.questions.filter(q=>q.hasImage&&q.id!==selected.id).map(q=><option value={q.id} key={q.id}>第 {q.number} 題 · ID {q.id}</option>)}</select></label>{attach?.images.map(i=><div key={i.index}><ImageViewer src={i.url} alt={`來源題 ${attach.number} 圖片 ${i.index+1}`}/><button type="button" className="study-button" disabled={draft.images.length>=8} onClick={()=>edit({images:[...draft.images,{input:{questionId:i.questionId,index:i.index,revision:i.revision},url:i.url}]})}>附加圖片 {i.index+1}</button></div>)}<p className={styles.muted}>附加只建立本題副本，不會移除來源題圖片。移除圖片也不會刪除歷史版本。</p></details></details>
      <details><summary>VetExam 精選解析 · {selected.explanationStatus==='published'?'已發布':'草稿／尚未撰寫'}</summary><label className={base.field}>解析 Markdown<textarea aria-label="解析 Markdown" rows={10} maxLength={20000} value={draft.explanation} onChange={e=>edit({explanation:e.target.value})}/></label><OfficialExplanation content={draft.explanation}/><p>本工作台儲存後解析回到草稿，請沿用題目維護中心審核發布。</p></details></>}
      <details open={!!issues.length}><summary>檢查資訊（{issues.length} 項提示）</summary>{issues.length?<ul className={base.warning}>{issues.map(s=><li key={s}>{s}</li>)}</ul>:<p>未偵測到規則異常，仍需人工核對原題。</p>}<p className={styles.muted}>本題首次統計 {selected.stats.first_answers} 筆、練習歷史 {selected.stats.attempts} 筆、教練快照 {selected.stats.coach} 筆。歷史成績保留作答當時結果，可能與修正後題目不同。</p></details>
      <div className={styles.checks}>{(optionsChanged||answerChanged)&&<label><input type="checkbox" checked={confirmAnswer} onChange={e=>setConfirmAnswer(e.target.checked)}/>我已重新確認選項代號及所有官方接受答案</label>}{dirty&&!!draft.explanation.trim()&&<label><input type="checkbox" checked={confirmExplanation} onChange={e=>setConfirmExplanation(e.target.checked)}/>我已確認解析是否符合修改後題目，並了解儲存為草稿</label>}
      {answerChanged&&!optionsChanged&&draft.question===selected.question&&<label><input type="checkbox" checked={recalculate} onChange={e=>setRecalculate(e.target.checked)}/>重算本題 {selected.stats.first_answers} 筆有效首次作答統計（不刪除紀錄；不改歷史練習或教練快照）</label>}</div>
      <div className={`${styles.toolbar} ${styles.sticky}`}><button type="button" className="study-button" disabled={index<=0} onClick={()=>move(-1)}>上一題</button><button type="button" className="study-button study-button-primary" disabled={!dirty} onClick={()=>save()}>儲存</button><button type="button" className="study-button study-button-primary" disabled={!dirty||index>=(bank.questions.length-1)} onClick={()=>save(true)}>儲存並下一題</button><button type="button" className="study-button" disabled={index>=(bank.questions.length-1)} onClick={()=>move(1)}>下一題</button></div>
      </fieldset>
      <details className={styles.history}><summary onClick={()=>{if(!history.length)request<{history:History[]}>('?id='+selected.id+'&history=1').then(d=>setHistory(d.history)).catch(e=>setError(e.message));}}>修改歷史與單題回復（最近 50 筆）</summary>{history.map(h=><article key={h.id}><p>{new Date(h.created_at).toLocaleString()} · {h.actor_id} · {h.action} · {h.changed_fields.join('、')}</p><details onToggle={e=>{if(e.currentTarget.open&&!h.detailed)request<{history:History[]}>("?id="+selected.id+"&history=1&historyId="+h.id).then(d=>{if(d.history[0])setHistory(items=>items.map(item=>item.id===h.id?{...d.history[0],detailed:true}:item));}).catch(err=>setError(err.message));}}><summary>檢查修改前後差異</summary><pre>{JSON.stringify({修改前:h.before,修改後:h.after},null,2)}</pre></details>{['save','restore'].includes(h.action)&&<button className="study-button" disabled={busy||dirty} onClick={()=>{if(confirm('回復這次修改前的題目內容？不會回復已發布狀態，也不會回寫歷史成績。請確認舊版答案及解析。')){requestId.current=crypto.randomUUID();void execute('restore',{historyId:Number(h.id),confirmAnswer:true,confirmExplanation:true});}}}>回復此修改前版本</button>}</article>)}</details>
    </section>}</div></div>}
  </AdminShell>;
}
