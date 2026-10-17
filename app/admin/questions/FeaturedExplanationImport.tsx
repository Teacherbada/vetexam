'use client';
import { useRef, useState } from 'react';
import OfficialExplanation from '@/components/questions/OfficialExplanation';
import { formatAnswer } from '@/lib/question-answer';
import { IMPORT_FILE_BYTES, importLabels, type ExplanationImportRow, type ImportCategory, type ImportResult } from '@/lib/featured-explanation-import-input';
import styles from './questions.module.css';

export default function FeaturedExplanationImport({ onImported }: { onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [input, setInput] = useState<unknown>(null);
  const [rows, setRows] = useState<ExplanationImportRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<ImportCategory | 'all'>('all');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [handoffPreview, setHandoffPreview] = useState(false);
  const operation = useRef(false);
  const requestId = useRef<string | null>(null);
  function reset() { requestId.current = null; setRows([]); setSelected(new Set()); setInput(null); setConfirmed(false); setResult(null); setError(''); setFilter('all'); setHandoffPreview(false); }
  async function request(body: unknown) {
    const response = await fetch('/api/admin/questions/explanation/import', {
      method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      // Keep the same request ID and selection available after an uncertain response.
      throw Error(data.error || '匯入暫時無法完成，請重新預覽');
    }
    return data;
  }
  async function preview() {
    if (!file || operation.current) return;
    operation.current = true; setBusy(true); reset();
    try {
      if (file.size > IMPORT_FILE_BYTES) throw Error('JSON 檔案最多 2 MiB');
      let parsed: unknown;
      try { parsed = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); }
      catch { throw Error('JSON 格式錯誤，請修正檔案後重新上傳'); }
      const data = await request({ action: 'preview', input: parsed });
      setInput(parsed); setRows(data.rows); setHandoffPreview(data.handoffPreview === true);
    } catch (e) { setError(e instanceof Error ? e.message : '預覽失敗'); }
    finally { operation.current = false; setBusy(false); }
  }
  async function apply() {
    if (!confirmed || !selected.size || operation.current || result) return;
    operation.current = true; setBusy(true); setError('');
    try {
      requestId.current ??= crypto.randomUUID();
      const data: ImportResult = await request({ action: 'import', input, requestId:requestId.current,
        selected: rows.filter(row => selected.has(row.index)).map(row => ({ index: row.index, token: row.token })) });
      setResult(data); setSelected(new Set()); setConfirmed(false);
      if (data.success) onImported();
    } catch (e) { setError(e instanceof Error ? e.message : '儲存失敗，請重新預覽確認實際狀態'); }
    finally { operation.current = false; setBusy(false); }
  }
  return <details className={styles.card}>
    <summary className="study-button">批次匯入精選解析</summary>
    <section aria-label="批次匯入精選解析">
      <h2>批次匯入精選解析</h2>
      <p className={styles.muted}>每批 1–50 筆、檔案最多 2 MiB；每筆解析含參考網址最多 20,000 字元。僅適用於公開國考題目，既有草稿及已發布解析皆不覆蓋。</p>
      <p className={styles.muted}>questionId 請使用本頁的題目 ID。來源網址會附加至解析末尾；匯入不會核實教材內容，請逐題人工審核後再發布。</p>
      <p className={styles.muted}>新版 ChatGPT 結構化解析每批最多 20 題，確認後只儲存草稿；網址格式正確不代表文獻內容已查證。</p>
      <div className={styles.actions}>
        <a className="study-button" href="/examples/featured-explanations.example.json" download>下載 JSON 範例</a>
        <a className="study-button" href="/examples/featured-explanations.schema.json" download>下載 JSON Schema</a>
        <a className="study-button" href="/examples/explanation-handoff.schema.json" download>下載新版回傳 Schema</a>
        <a className="study-button" href="/examples/explanation-handoff.example.json" download>下載新版回傳範例</a>
        <a className="study-button" href="/api/admin/questions/explanation/import" target="_blank" rel="noreferrer">查看最近 20 筆匯入收據</a>
      </div>
      <fieldset disabled={busy}>
        <label className={styles.field}>選擇 JSON 檔案<input aria-label="精選解析 JSON 檔案" type="file" accept=".json,application/json" onChange={event => { reset(); setFile(event.target.files?.[0] ?? null); }} /></label>
        <button className="study-button" disabled={!file} onClick={preview}>上傳並驗證預覽</button>
      </fieldset>
      {busy && <p role="status">處理中，請稍候…</p>}
      {error && <p className={styles.warning} role="alert">{error}</p>}
      {rows.length > 0 && <>
        <p>{result ? '本次處理已結束，以下保留匯入前預覽。' : `預覽共 ${rows.length} 筆，尚未寫入。預覽有效 15 分鐘。`}</p>
        <label className={styles.field}>驗證分類<select aria-label="解析匯入驗證分類" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
          <option value="all">全部（{rows.length}）</option>
          {(Object.keys(importLabels) as ImportCategory[]).map(key => <option key={key} value={key}>{importLabels[key]}（{rows.filter(row => row.category === key).length}）</option>)}
        </select></label>
        {<div className={styles.actions}>
          <button className="study-button" disabled={busy || Boolean(result)} onClick={() => { setSelected(new Set(rows.filter(row => row.category === 'ready').map(row => row.index))); setConfirmed(false); }}>勾選全部可匯入</button>
          <button className="study-button" disabled={busy || Boolean(result)} onClick={() => { setSelected(new Set()); setConfirmed(false); }}>取消勾選</button>
          <span>已勾選 {selected.size} 筆</span>
        </div>}
        {rows.filter(row => filter === 'all' || row.category === filter).map(row => <article className={styles.card} key={row.index} data-import-row={row.index}>
          <label><input type="checkbox" aria-label={`匯入第 ${row.index + 1} 筆`} disabled={busy || Boolean(result) || row.category !== 'ready'} checked={selected.has(row.index)} onChange={event => { setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(row.index); else next.delete(row.index); return next; }); setConfirmed(false); }} /> 第 {row.index + 1} 筆 · ID {row.questionId ?? '無效'} · <strong>{importLabels[row.category]}</strong></label>
          <p className={styles.question}>{row.summary || '無可用題目摘要'}</p>
          <p>檔案答案：{formatAnswer(row.expectedAnswer) || '未提供'} · 題庫答案：{formatAnswer(row.answer) || '無可用答案'}</p>
          {row.reason && <p className={styles.warningText}>{row.reason}</p>}
          {row.questionFingerprint && <details><summary>{handoffPreview ? '題目指紋（新版必填）' : '題目指紋（選填核對用）'}</summary><p className={styles.question}>{row.questionFingerprint}</p></details>}
          <details><summary>解析預覽</summary><OfficialExplanation content={row.explanation} /></details>
        </article>)}
        {!result && <>
          <label><input type="checkbox" checked={confirmed} disabled={busy || !selected.size} onChange={event => setConfirmed(event.target.checked)} /> 我已核對勾選的題目 ID、答案與解析，確認只儲存草稿</label>
          <div className={styles.actions}><button className="study-button study-button-primary" disabled={busy || !confirmed || !selected.size} onClick={apply}>確認匯入並儲存草稿（{selected.size} 筆）</button></div>
        </>}
      </>}
      {result && <div role="status" className={styles.success}>
        {result.receiptId && <p>匯入收據：<a href={`/api/admin/questions/explanation/import?receiptId=${result.receiptId}`} target="_blank" rel="noreferrer">{result.receiptId}</a>{result.replayed ? '（已取回原交易結果，未重複寫入）' : ''}</p>}
        <p>匯入結果：成功 {result.success} 筆、失敗 {result.failed} 筆、略過 {result.skipped} 筆。</p>
        <p>成功項目均為草稿。請從題目清單「查看／編輯」進行審核與發布。</p>
        <ul>{result.rows.map(row => <li key={row.index}>第 {row.index + 1} 筆 · ID {row.questionId ?? '無效'}：{row.reason}</li>)}</ul>
      </div>}
    </section>
  </details>;
}
