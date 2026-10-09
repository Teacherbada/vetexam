'use client';
import Link from 'next/link';
import { fetchAI } from '@/lib/ai-question-client';
import { useEffect, useRef, useState } from 'react';
import { EXAM_SUBJECTS, chapterGroups } from '@/data/exam-chapters';
import { AI_METHOD, type AIQuestionInput, type AIPreview } from '@/lib/ai-question-input';
import AISource from '@/components/questions/AISource';
import styles from '../questions/questions.module.css';

type Row = { id: string; position: number; content: AIQuestionInput; revision: number; status: string; review_status: string; reviewed_at: string | null; reviewed_by: string | null };
type Batch = { id: string; name: string; total: number; drafts: number; published: number; created_at: string; result: { excluded?: { index: number; errors: string[] }[] } };
async function api(body?: unknown, query = '') {
  const response = await fetchAI('/api/admin/ai-questions' + query, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '操作失敗');
  return data;
}
export default function AIQuestionsAdmin() {
  const [text, setText] = useState(''), [preview, setPreview] = useState<AIPreview | null>(null), [onlyValid, setOnlyValid] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]), [next, setNext] = useState<string | null>(null), [batchId, setBatchId] = useState(''), [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState('all'), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const lock = useRef(false), requestKey = useRef('');
  async function loadBatches(after = '') { const data = await api(undefined, after ? '?after=' + after : ''); setBatches(current => { if (after) return [...current, ...data.batches.filter((fresh: Batch) => !current.some(b => b.id === fresh.id))]; return [...data.batches, ...current.filter(b => b.id === batchId && !data.batches.some((fresh: Batch) => fresh.id === b.id))]; }); setNext(data.next); }
  useEffect(() => {
    let cancelled = false;
    api().then(data => { if (!cancelled) { setBatches(data.batches); setNext(data.next); } }).catch(e => { if (!cancelled) setMessage(e.message); });
    return () => { cancelled = true; };
  }, []);
  async function task(run: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setBusy(true); setMessage('');
    try { await run(); } catch (e) { setMessage(e instanceof Error ? e.message : '操作失敗'); }
    finally { lock.current = false; setBusy(false); }
  }
  function changeText(value: string) { setText(value); setPreview(null); setOnlyValid(false); requestKey.current = ''; }
  async function openBatch(id: string) { const data = await api(undefined, '?batch=' + id); setRows(data.questions); setBatchId(id); }
  return <main className={styles.page + ' break-words'}><div className={styles.container}>
    <header className={styles.heading}><div><h1>AI 試題題庫</h1><p>管理員批次匯入、逐題人工審核後發布。成功匯入不代表已審核。</p></div>
      <nav><Link href="/pdf">返回匯入介面</Link><Link href="/admin/questions">國考題維護</Link><Link href="/ai-questions">會員練習</Link></nav></header>
    {message && <p role="status" className={styles.warning}>{message}</p>}
    <section className={styles.card}><h2>批次匯入 JSON</h2><p>每批 1–200 題，最多 2 MB；固定四選一。題目與來源由管理員在網站外準備。</p>
      <p className={styles.muted}>來源至少提供書名／講義名、支持答案的摘錄及一項定位（來源章節、印刷頁碼或 PDF 頁次）。未知欄位留空；請勿填入私人教材下載連結。</p>
      <div className={styles.actions}><a href="/examples/ai-questions.json" download className="study-button">下載 JSON 範例</a><a href="/examples/ai-source.txt" download className="study-button">下載範例來源教材</a></div>
      <details><summary>查看可用的官方科目與章節</summary>{EXAM_SUBJECTS.map(s => <p key={s} className={styles.question}><strong>{s}</strong>：{chapterGroups(s).flatMap(g => g.chapters).join('、')}</p>)}</details>
      <fieldset disabled={busy}>
        <label className={styles.field}>上傳 JSON 檔案<input type="file" accept=".json,application/json" onChange={e => {
          const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
          if (file.size > 1900000) { setMessage('JSON 檔案過大，請拆成較小批次'); return; }
          void task(async () => { changeText(await file.text()); });
        }} /></label>
        <label className={styles.field}>或貼上／修正 JSON<textarea aria-label="或貼上／修正 JSON" rows={12} value={text} onChange={e => changeText(e.target.value)} placeholder={'{"name":"教材批次名稱","questions":[…]}'} /></label>
        <button className="study-button" onClick={() => void task(async () => {
          setPreview(null); setOnlyValid(false);
          const input = JSON.parse(text); const data = await api({ action: 'preview', input });
          requestKey.current = crypto.randomUUID(); setPreview(data);
        })}>解析並預覽</button>
      </fieldset>
      {preview && <div className="mt-5">
        <p>有效 {preview.valid} 題；有錯誤 {preview.invalid} 題。請逐題查看下方預覽。</p>
        {preview.rows.map(row => <details key={row.index} className={styles.card} open={!!row.errors.length}>
          <summary>第 {row.index} 題｜{row.errors.length ? '不可匯入' : '有效，尚未審核'}｜{row.question?.question.slice(0,60)}</summary>
          {row.errors.length > 0 && <ul className={styles.warning}>{row.errors.map(e => <li key={e}>{e}</li>)}</ul>}
          {row.warnings.map(w => <p key={w} className={styles.muted}>{w}</p>)}
          {row.question && <><p>{row.question.subject}／{row.question.chapter}</p><p className={styles.question}>{row.question.question}</p>
            {row.question.options.map((o,i) => <p key={i}>{'ABCD'[i]}．{o}</p>)}<p>答案：{row.question.answer}</p><p className={styles.question}>{row.question.explanation}</p>
            {row.question.optionExplanations.map((e,i) => e && <p key={i}>{'ABCD'[i]} 解析：{e}</p>)}<AISource source={row.question.source} /></>}
        </details>)}
        {preview.invalid > 0 && <label className={styles.warning}><input type="checkbox" disabled={busy} checked={onlyValid} onChange={e => setOnlyValid(e.target.checked)} /> 我已查看錯誤，明確選擇只匯入 {preview.valid} 題有效題目（排除 {preview.invalid} 題）</label>}
        <div className={styles.actions}><button className="study-button" disabled={busy || !preview.valid || (preview.invalid > 0 && !onlyValid)} onClick={() => void task(async () => {
          const result = await api({ action: 'import', input: JSON.parse(text), token: preview.token, onlyValid, requestKey: requestKey.current });
          setPreview(null); await loadBatches(); await openBatch(result.batchId);
          setMessage((result.replayed ? '此批次先前已完成，未重複匯入。' : '匯入完成。') + ' ' + result.imported + ' 題皆為草稿／待審核；排除 ' + result.excluded.length + ' 題。');
        })}>確認匯入為草稿</button></div>
      </div>}
    </section>
    <section className={styles.card}><h2>批次題庫與人工審核</h2>
      <div className={styles.actions}><button className="study-button" disabled={busy} onClick={() => void task(async () => { await loadBatches(); if (batchId) await openBatch(batchId); })}>重新載入</button></div>
      <label className={styles.field}>選擇批次<select aria-label="選擇批次" disabled={busy} value={batchId} onChange={e => { const id = e.target.value; if (id) void task(() => openBatch(id)); else { setBatchId(''); setRows([]); } }}><option value="">請選擇批次</option>
        {batches.map(b => <option key={b.id} value={b.id}>{b.name}｜草稿 {b.id === batchId ? rows.filter(r => r.status === 'draft').length : b.drafts}／發布 {b.id === batchId ? rows.filter(r => r.status === 'published').length : b.published}（共 {b.total} 題）</option>)}</select></label>
      {next && <button className="study-button" disabled={busy} onClick={() => void task(() => loadBatches(next))}>載入更多批次</button>}
      {batches.find(b => b.id === batchId)?.result.excluded?.map(e => <p key={e.index} className={styles.warning}>匯入時已明確排除第 {e.index} 題：{e.errors.join('；')}</p>)}
      <label className={styles.field}>發布狀態<select aria-label="發布狀態" value={status} onChange={e => setStatus(e.target.value)}><option value="all">全部草稿與已發布</option><option value="draft">草稿／待審核</option><option value="published">已發布／已人工審核</option></select></label>
      {batchId && <p>此批次共 {rows.length} 題；修改任何內容後，必須重新審核發布。既有作答紀錄會保留。</p>}
      {rows.filter(r => status === 'all' || r.status === status).map(row => <Editor key={row.id + ':' + row.revision} row={row} busy={busy} save={(action, content, confirmReview) => task(async () => {
        const data = await api({ action, id: row.id, revision: row.revision, content, confirmReview });
        setRows(current => current.map(r => r.id === row.id ? data.question : r));
        await loadBatches(); setMessage(action === 'publish' ? '已記錄人工審核並發布。' : '已儲存為草稿／待審核；原有作答紀錄保留。');
      })} />)}
    </section>
  </div></main>;
}
function Editor({ row, busy, save }: { row: Row; busy: boolean; save: (action: string, content: AIQuestionInput, confirmed: boolean) => Promise<void> }) {
  const [q, setQ] = useState(row.content), [confirmed, setConfirmed] = useState(false);
  const dirty = JSON.stringify(q) !== JSON.stringify(row.content);
  function patch(p: Partial<AIQuestionInput>) { setQ(current => ({ ...current, ...p })); setConfirmed(false); }
  return <details className={styles.card}><summary>第 {row.position} 題｜{row.status === 'published' ? '已發布／已人工審核' : '草稿／待審核'}｜{q.question.slice(0,70)}</summary>
    <p>版本 {row.revision}{row.reviewed_at ? '；人工審核時間：' + new Date(row.reviewed_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '；尚未完成人工審核'}</p>
    <fieldset disabled={busy}>
      <label className={styles.field}>科目<select aria-label="科目" value={q.subject} onChange={e => patch({ subject: e.target.value, chapter: '' })}>{EXAM_SUBJECTS.map(s => <option key={s}>{s}</option>)}</select></label>
      <label className={styles.field}>官方章節<select aria-label="官方章節" value={q.chapter} onChange={e => patch({ chapter: e.target.value })}><option value="">請選擇章節</option>{chapterGroups(q.subject).flatMap(g => g.chapters).map(c => <option key={c}>{c}</option>)}</select></label>
      <label className={styles.field}>題幹<textarea aria-label="題幹" rows={4} value={q.question} onChange={e => patch({ question: e.target.value })} /></label>
      {q.options.map((o,i) => <label className={styles.field} key={i}>選項 {'ABCD'[i]}<textarea aria-label={'選項 ' + 'ABCD'[i]} rows={2} value={o} onChange={e => patch({ options: q.options.map((v,j) => i === j ? e.target.value : v) })} /></label>)}
      <label className={styles.field}>唯一正確答案<select aria-label="唯一正確答案" value={q.answer} onChange={e => patch({ answer: e.target.value })}>{['A','B','C','D'].map(a => <option key={a}>{a}</option>)}</select></label>
      <label className={styles.field}>完整解析<textarea aria-label="完整解析" rows={5} value={q.explanation} onChange={e => patch({ explanation: e.target.value })} /></label>
      {q.optionExplanations.map((v,i) => <label className={styles.field} key={i}>選項 {'ABCD'[i]} 解析（選填）<textarea aria-label={'選項 ' + 'ABCD'[i] + ' 解析（選填）'} rows={2} value={v} onChange={e => patch({ optionExplanations: q.optionExplanations.map((s,j) => i === j ? e.target.value : s) })} /></label>)}
      {([['title','書名／講義名'],['edition','版本（未知留空）'],['chapter','來源章節'],['printedPages','書本印刷頁碼'],['pdfPages','PDF 頁次'],['excerpt','支持答案的簡短來源摘錄'],['url','公開來源 HTTPS 連結（選填；不要連結私人教材）']] as const).map(([key,label]) =>
        <label className={styles.field} key={key}>{label}<textarea aria-label={label} rows={key === 'excerpt' ? 3 : 1} value={q.source[key]} onChange={e => patch({ source: { ...q.source, [key]: e.target.value } })} /></label>)}
      <p>{AI_METHOD}</p>
      <AISource source={row.content.source} />
      <div className={styles.actions}><button className="study-button" disabled={!dirty} onClick={() => void save('save',q,false)}>儲存修改並待審核</button>
        {row.status === 'published' && <button className="study-button" onClick={() => void save('unpublish',q,false)}>撤回為草稿</button>}</div>
      {row.status === 'draft' && <><label><input type="checkbox" disabled={dirty} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> 我已人工核對題幹、選項、答案、解析、來源及其可公開性</label>
        <div className={styles.actions}><button className="study-button" disabled={dirty || !confirmed} onClick={() => void save('publish',q,confirmed)}>確認審核並發布此題</button></div>
        {dirty && <p>請先儲存修改，再核對已儲存內容並發布。</p>}</>}
    </fieldset>
  </details>;
}
