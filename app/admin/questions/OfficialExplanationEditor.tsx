'use client';
import { useEffect, useRef, useState } from 'react';
import OfficialExplanation from '@/components/questions/OfficialExplanation';
import styles from './questions.module.css';

type Saved = { id: number; explanation: string; revision: string; status: 'unwritten' | 'draft' | 'published' };
async function request(url: string, options?: RequestInit): Promise<Saved> {
  const response = await fetch(url, { ...options, cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '精選解析暫時無法儲存');
  return data;
}

export default function OfficialExplanationEditor({ questionId, disabled, onSaved }: {
  questionId: number; disabled: boolean; onSaved: (explanation: string, status: Saved['status']) => void;
}) {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [draft, setDraft] = useState('');
  const [preview, setPreview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [reload, setReload] = useState(0);
  const operation = useRef(false);
  const dirty = saved !== null && draft !== saved.explanation;
  useEffect(() => {
    const controller = new AbortController();
    request(`/api/admin/questions/explanation?id=${questionId}`, { signal: controller.signal })
      .then(result => { setReviewed(false); setSaved(result); setDraft(result.explanation); setLoading(false); })
      .catch(e => { if (!controller.signal.aborted) { setError(e.message); setLoading(false); } });
    return () => controller.abort();
  }, [questionId, reload]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function save(action: 'draft' | 'publish' | 'unpublish') {
    if (!saved || operation.current || disabled) return;
    operation.current = true; setSaving(true); setError(''); setNotice('');
    try {
      const result = await request('/api/admin/questions/explanation', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: questionId, explanation: draft, revision: saved.revision, action, ...(action === 'publish' ? { confirmReview: reviewed } : {}) }),
      });
      setSaved(result); setDraft(result.explanation); setReviewed(false);
      setNotice(action === 'publish' ? '已人工確認並發布解析' : action === 'unpublish' ? '已取消發布，內容保留為草稿' : '草稿已儲存，考生無法閱讀'); onSaved(result.explanation, result.status);
    } catch (e) { setError(e instanceof Error ? e.message : '儲存失敗，草稿已保留'); }
    finally { operation.current = false; setSaving(false); }
  }
  return <section aria-label="精選解析編輯"><h3>VetExam 精選解析</h3>
    {saved && <p>解析狀態：<strong>{({ unwritten: '尚未撰寫', draft: '草稿', published: '已發布' })[saved.status]}</strong></p>}
    <p className={styles.muted}>儲存草稿會暫停公開解析；確認內容正確後才能發布。取消發布會保留內容。正確答案以題庫答案欄位為準。</p>
    <p className={styles.muted}>支援貼上 Markdown：標題、粗體、段落、清單、表格與參考網址；各段落皆可選填。最多 20,000 字元。</p>
    {loading ? <p role="status">載入精選解析中…</p> : <>
      <div className={styles.actions} role="group" aria-label="精選解析模式">
        <button type="button" className="study-button" aria-pressed={!preview} onClick={() => setPreview(false)}>編輯</button>
        <button type="button" className="study-button" aria-pressed={preview} onClick={() => setPreview(true)}>預覽</button>
      </div>
      {preview ? <div aria-label="精選解析預覽">{draft.trim() ? <OfficialExplanation content={draft} /> : <p className={styles.muted}>尚未提供精選解析。</p>}</div> :
        <label className={styles.field}>精選解析內容<textarea aria-label="精選解析內容" rows={16} value={draft} disabled={!saved || saving || disabled} onChange={event => { setDraft(event.target.value); setReviewed(false); setNotice(''); }} placeholder={'### 核心考點\n\n在此貼上或編寫解析…'} /></label>}
      <p className={styles.muted} role="status">{saving ? '儲存中…' : notice || (dirty ? '有尚未儲存的變更' : saved?.explanation.trim() ? '已載入儲存的解析' : '尚未提供精選解析')} · {draft.length.toLocaleString()} / 20,000 字元</p>
      <label className={styles.muted}><input type="checkbox" checked={reviewed} disabled={saving || disabled} onChange={event => setReviewed(event.target.checked)} /> 我已人工核對解析及參考資料，確認與題庫答案一致。</label>
      <div className={styles.actions}>
        <button type="button" className="study-button" disabled={!saved || saving || disabled || (!dirty && saved.status !== 'published') || !draft.trim() || draft.length > 20000} onClick={() => save('draft')}>儲存草稿</button>
        <button type="button" className="study-button study-button-primary" disabled={!saved || saving || disabled || !reviewed || !draft.trim() || draft.length > 20000 || (!dirty && saved.status === 'published')} onClick={() => save('publish')}>發布解析</button>
        <button type="button" className="study-button" disabled={!saved || saving || disabled || dirty || saved.status !== 'published'} onClick={() => save('unpublish')}>取消發布</button>
        <button type="button" className="study-button" disabled={saving || disabled} onClick={() => {
          if (dirty && !window.confirm('重新載入會捨棄尚未儲存的草稿。請先複製保留需要的內容，確定重新載入嗎？')) return;
          setError(''); setNotice(''); setLoading(true); setReload(value => value + 1);
        }}>重新載入解析</button>
      </div>
    </>}
    {error && <p role="alert" className={styles.warning}>{error}</p>}
  </section>;
}
