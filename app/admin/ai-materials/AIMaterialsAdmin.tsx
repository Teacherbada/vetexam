'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { EXAM_SUBJECTS, chapterGroups } from '@/data/exam-chapters';
import { fetchAI } from '@/lib/ai-question-client';
import { uploadLargeMaterial } from '@/lib/ai-material-upload-client';
import { MATERIAL_LIMITS, type MaterialPage, type MaterialSpec } from '@/lib/ai-material-input';
import styles from '../questions/questions.module.css';
type Material = {id:string;filename:string;pages:MaterialPage[]};
type Job = {id:string;batch_id:string;spec:MaterialSpec;model:string;reserved_micro_usd:number};
type Item = {position:number;status:string;error:string|null;actual_micro_usd:number|null};
const money=(micro:number)=>'USD '+(micro/1000000).toFixed(5);
const initial: MaterialSpec={materialId:'',title:'',edition:'',subject:EXAM_SUBJECTS[0],chapter:'',sourceChapter:'',start:1,end:1,count:3,difficulty:'中等',printedPages:{}};
async function api(body?: unknown,query='') {
  const response=await fetchAI('/api/admin/ai-materials'+query,body instanceof FormData ? {method:'POST',body} : body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {cache:'no-store'},55000);
  const data=await response.json(); if (!response.ok) throw new Error(data.error || '操作失敗'); return data;
}
export default function AIMaterialsAdmin() {
  const [material,setMaterial]=useState<Material|null>(null), [spec,setSpec]=useState(initial), [page,setPage]=useState(1);
  const [materials,setMaterials]=useState<{id:string;filename:string}[]>([]), [jobs,setJobs]=useState<Job[]>([]), [job,setJob]=useState<Job|null>(null), [items,setItems]=useState<Item[]>([]);
  const [configured,setConfigured]=useState(false), [loaded,setLoaded]=useState(false), [busy,setBusy]=useState(false), [message,setMessage]=useState('');
  const [estimate,setEstimate]=useState<number|null>(null), [confirmText,setConfirmText]=useState(false), [confirmCost,setConfirmCost]=useState(false);
  const upload=useRef({identity:'',id:''});
  const lock=useRef(false), requestKey=useRef(''), stop=useRef(false);
  useEffect(()=>{let mounted=true; api().then(d=>{if(mounted){setMaterials(d.materials);setJobs(d.jobs);setConfigured(d.keyConfigured);setLoaded(true);}}).catch(e=>{if(mounted)setMessage(e.message);});return()=>{mounted=false;stop.current=true;};},[]);
  function patch(p:Partial<MaterialSpec>) {setSpec(s=>({...s,...p}));setEstimate(null);setConfirmText(false);setConfirmCost(false);requestKey.current='';}
  async function task(run:()=>Promise<void>) {if(lock.current)return;lock.current=true;setBusy(true);setMessage('');try{await run();}catch(e){setMessage(e instanceof Error?e.message:'操作失敗');}finally{lock.current=false;setBusy(false);}}
  async function refresh() {const d=await api();setMaterials(d.materials);setJobs(d.jobs);setConfigured(d.keyConfigured);setLoaded(true);}
  async function openMaterial(id:string) {const d=await api(undefined,'?material='+id);setMaterial(d.material);setPage(1);setSpec({...initial,materialId:id,title:d.material.filename.replace(/\.pdf$/i,'')});setEstimate(null);setConfirmText(false);setConfirmCost(false);requestKey.current='';}
  async function progress(id:string) {const d=await api(undefined,'?job='+id);setJob(d.job);setItems(d.items);return d.items as Item[];}
  async function run(id:string) {
    stop.current=false;
    for(let i=0;i<MATERIAL_LIMITS.maxQuestions && !stop.current;i++) {
      const result=await api({action:'step',jobId:id}); const current=await progress(id);
      if(result.stopped){setMessage(result.reason);break;}
      if(!current.some(item=>item.status==='pending')){setMessage('本批處理完畢；草稿仍需人工審核後發布。');break;}
    }
    await refresh();
  }
  const current=material?.pages.find(p=>p.page===page);
  const selected=material?.pages.filter(p=>p.page>=spec.start&&p.page<=spec.end) || [];
  const statusName:Record<string,string>={pending:'尚未開始',running:'處理中（請勿重複啟動）',done:'已存草稿／待人工審核',failed:'失敗／不重試',uncertain:'結果不明／不重試'};
  return <main className={styles.page+' break-words'}><div className={styles.container}>
    <header className={styles.heading}><div><h1>教材 PDF 出題</h1><p>從指定教材文字創作 AI 試題，全部先存成草稿。</p></div><nav><Link href="/admin/ai-questions">AI 題庫／審核與 JSON 匯入</Link><Link href="/pdf">國考 PDF 題目匯入</Link></nav></header>
    <p>AI 試題｜非歷屆國考題。依管理員提供的教材由 AI 生成，經人工審核後發布；不代表官方命題。</p>
    {message && <p role="status" className={styles.warning}>{message}</p>}
    {loaded&&!configured&&<p className={styles.warning}>伺服器尚未設定 OPENAI_API_KEY，尚未完成真實生成驗證。仍可上傳、預覽與估算費用。</p>}
    <section className={styles.card}><h2>1. 上傳教材並預覽文字</h2><p>最多 100 MB、100 頁。上傳與預覽不呼叫 AI、不產生模型費用。超過 3 MB 自動分段；中斷後可重新選取同一檔案續傳。教材只供管理員查看；會員只會看到核准的短摘錄。</p>
      <p>本版不提供 OCR 或圖表理解。掃描頁請先 OCR 並校對後上傳；需要圖表、公式或表格布局才能判斷的內容，請人工出題。</p>
      <p><a href="/examples/ai-material-sample.pdf" download>下載可測試的文字教材 PDF</a></p>
      <fieldset disabled={busy}><label className={styles.field}>教材 PDF<input type="file" accept="application/pdf,.pdf" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;if(file.size>MATERIAL_LIMITS.maxFileBytes){setMessage('PDF 最多 100 MB');return;}void task(async()=>{const identity=JSON.stringify([file.name,file.size,file.lastModified]);if(upload.current.identity!==identity)upload.current={identity,id:crypto.randomUUID()};
const form=new FormData();form.append('file',file);const d=file.size>MATERIAL_LIMITS.directFileBytes?await uploadLargeMaterial(file,upload.current.id,setMessage):await api(form);setMaterial(d.material);setPage(1);setSpec({...initial,materialId:d.material.id,title:file.name.replace(/\.pdf$/i,'')});setEstimate(null);setConfirmText(false);setConfirmCost(false);requestKey.current='';await refresh();});}} /></label>
      <label className={styles.field}>已上傳教材（最近 100 份）<select aria-label="已上傳教材（最近 100 份）" value={material?.id||''} onChange={e=>{if(e.target.value)void task(()=>openMaterial(e.target.value));}}><option value="">選擇教材</option>{materials.map(m=><option key={m.id} value={m.id}>{m.filename}</option>)}</select></label></fieldset>
      {material&&<><label className={styles.field}>預覽 PDF 頁次<select aria-label="預覽 PDF 頁次" value={page} onChange={e=>setPage(Number(e.target.value))}>{material.pages.map(p=><option key={p.page} value={p.page}>PDF 第 {p.page} 頁{p.usable?'':'｜需 OCR／人工處理'}</option>)}</select></label>
        <p className={styles.warning}>{current?.warning}</p><p><a href={'/api/admin/ai-materials?material='+material.id+'&pdf=1#page='+page} target="_blank" rel="noopener noreferrer">開啟原始 PDF 第 {page} 頁（限管理員）</a></p>
        <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:320,overflowY:'auto'}}>{current?.text || '無可擷取文字，請先進行 OCR。'}</pre>
      </>}
    </section>
    {material&&<section className={styles.card}><h2>2. 指定內容、確認費用後生成</h2><fieldset disabled={busy}>
      <label className={styles.field}>資料名稱<input value={spec.title} maxLength={200} onChange={e=>patch({title:e.target.value})}/></label>
      <label className={styles.field}>版本（未知留空）<input value={spec.edition} maxLength={200} onChange={e=>patch({edition:e.target.value})}/></label>
      <label className={styles.field}>科目<select aria-label="科目" value={spec.subject} onChange={e=>patch({subject:e.target.value,chapter:''})}>{EXAM_SUBJECTS.map(s=><option key={s}>{s}</option>)}</select></label>
      <label className={styles.field}>既有章節<select aria-label="既有章節" value={spec.chapter} onChange={e=>patch({chapter:e.target.value})}><option value="">請選擇章節</option>{chapterGroups(spec.subject).flatMap(g=>g.chapters).map(c=><option key={c}>{c}</option>)}</select></label>
      <label className={styles.field}>教材中的章節名稱（未知留空）<input value={spec.sourceChapter} onChange={e=>patch({sourceChapter:e.target.value})}/></label>
      <label className={styles.field}>起始 PDF 頁次<input type="number" min={1} max={material.pages.length} value={spec.start} onChange={e=>patch({start:Number(e.target.value)})}/></label>
      <label className={styles.field}>結束 PDF 頁次<input type="number" min={spec.start} max={material.pages.length} value={spec.end} onChange={e=>patch({end:Number(e.target.value)})}/></label>
      <p>PDF 頁次由擷取流程保存。下列印刷頁碼請對照原頁填寫，未知留空，不會自動推算。</p>
      {selected.map(p=><label key={p.page} className={styles.field}>PDF 第 {p.page} 頁的書本印刷頁碼<input value={spec.printedPages[String(p.page)]||''} maxLength={30} onChange={e=>patch({printedPages:{...spec.printedPages,[String(p.page)]:e.target.value}})}/>{!p.usable&&<span className={styles.warning}>{p.warning}</span>}</label>)}
      <label className={styles.field}>題數（1–10）<input type="number" min={1} max={10} value={spec.count} onChange={e=>patch({count:Number(e.target.value)})}/></label>
      <label className={styles.field}>難度<select aria-label="難度" value={spec.difficulty} onChange={e=>patch({difficulty:e.target.value})}>{['基礎','中等','進階'].map(d=><option key={d}>{d}</option>)}</select></label>
      <button className="study-button" onClick={()=>void task(async()=>{const d=await api({action:'estimate',spec});setEstimate(d.estimateMicroUSD);setConfirmCost(false);})}>檢查範圍與估算費用（不呼叫 AI）</button>
      {estimate!==null&&<div className="mt-4"><p>模型：{MATERIAL_LIMITS.model}。本批預估費用上限 <strong>{money(estimate)}</strong>；實際依用量計價，不含稅與匯率。每題最多 32,000 輸入／2,400 輸出 tokens，零自動重試，每批硬上限 USD 0.20、最近 24 小時 USD 2。</p>
        <label className={styles.field}><span><input type="checkbox" style={{width:18,minHeight:18,height:18,marginRight:8}} checked={confirmText} onChange={e=>setConfirmText(e.target.checked)}/> 我已逐頁對照原稿，確認文字可讀且順序正確；僅用不依賴圖表的文字出題。</span></label>
        <label className={styles.field}><span><input type="checkbox" style={{width:18,minHeight:18,height:18,marginRight:8}} checked={confirmCost} onChange={e=>setConfirmCost(e.target.checked)}/> 我同意將所選擷取文字傳送至 OpenAI，並接受本批費用上限。</span></label>
        <button className="study-button" disabled={!configured||!confirmText||!confirmCost} onClick={()=>void task(async()=>{requestKey.current ||= crypto.randomUUID();const d=await api({action:'start',spec,requestKey:requestKey.current,confirmText,confirmCost,estimateMicroUSD:estimate});await progress(d.jobId);if(d.replayed){setMessage('相同設定已有工作；未重複建立或扣費。請查看進度，必要時繼續尚未開始的題目。');await refresh();}else await run(d.jobId);})}>開始生成</button>
      </div>}
    </fieldset></section>}
    <section className={styles.card}><h2>3. 工作進度與草稿審核</h2><p>每題完成立即保存。關閉頁面會暫停後續題目；重開後可續接。失敗或結果不明的題目不會重試，已完成草稿保留。相同教材與設定會回到原工作。</p>
      <label className={styles.field}>歷次工作（最近 100 批）<select aria-label="歷次工作（最近 100 批）" disabled={busy} value={job?.id||''} onChange={e=>{if(e.target.value)void task(async()=>{await progress(e.target.value);});}}><option value="">選擇工作</option>{jobs.map(j=><option key={j.id} value={j.id}>{j.spec.title}｜PDF {j.spec.start}–{j.spec.end}｜{j.spec.count} 題</option>)}</select></label>
      {job&&<><p>{job.spec.title}｜{job.model}｜原批次費用上限 {money(job.reserved_micro_usd)}。已保存 {items.filter(i=>i.status==='done').length}／{items.length} 題。</p>
        <ul>{items.map(item=><li key={item.position}>第 {item.position} 題：{statusName[item.status]}{item.actual_micro_usd!==null?'｜模型用量費用 '+money(item.actual_micro_usd):''}{item.error&&<p className={styles.warning}>{item.error}</p>}</li>)}</ul>
        <div className={styles.actions}><button className="study-button" disabled={busy} onClick={()=>void task(async()=>{await progress(job.id);})}>重新整理進度</button>
          <button className="study-button" disabled={busy||!configured||!items.some(i=>['pending','running'].includes(i.status))} onClick={()=>void task(()=>run(job.id))}>繼續尚未開始的題目</button>
          {busy&&<button className="study-button" onClick={()=>{stop.current=true;setMessage('將於目前這一題處理完畢後暫停。');}}>完成目前題目後暫停</button>}
          <Link href={'/admin/ai-questions?batch='+job.batch_id}>查看本批草稿、逐題審核與批次發布</Link></div></>}
    </section>
  </div></main>;
}
