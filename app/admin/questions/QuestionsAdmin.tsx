'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { needsManualReview, normalizeAnswer, type AdminQuestion, type AnswerInput } from '@/lib/admin-question-input';
import type { AnswerPreview } from '@/lib/admin-questions';
import { formatExamYear } from '@/lib/exam-year';
import styles from './questions.module.css';

type Bank = { id: number; name: string; exam_year: number | null; exam_subject: string; visibility: string; total: number; missing_answer: number; missing_explanation: number };
type Data = { summary: { total: number; missing_answer: number; missing_explanation: number; missing_both: number; invalid: number; answer_null: number; answer_blank: number }; sets: Bank[]; questions: AdminQuestion[]; total: number };
type Preview = AnswerPreview & { token: string | null };
const labels = { added: '新增', same: '相同', changed: '答案將修改', skipped: '略過：人工確認', unmatched: '無法匹配' };
async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '讀取失敗');
  return data;
}

export default function QuestionsAdmin() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [bankId, setBankId] = useState('');
  const [bankQuestions, setBankQuestions] = useState<AdminQuestion[]>([]);
  const [bankLoading, setBankLoading] = useState(false);
  const [mode, setMode] = useState<'keyboard' | 'table' | 'sequence'>('keyboard');
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewInput, setPreviewInput] = useState<AnswerInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmStats, setConfirmStats] = useState(false);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [single, setSingle] = useState<AdminQuestion | null>(null);
  const [singleAnswer, setSingleAnswer] = useState('');
  const keyboard = useRef<HTMLDivElement>(null);
  const operation = useRef(false);
  const previewSection = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    requestJson<Data>(`/api/admin/questions?${query}&page=${page}`, { signal: controller.signal })
      .then(result => { setData(result); setLoading(false); })
      .catch(e => { if (!controller.signal.aborted) { setError(e.message); setLoading(false); } });
    return () => controller.abort();
  }, [query, page, revision]);
  useEffect(() => {
    if (!bankId) return;
    const controller = new AbortController();
    requestJson<{ questions: AdminQuestion[] }>(`/api/admin/questions?question_set_id=${bankId}&editor=1`, { signal: controller.signal })
      .then(result => { setBankQuestions(result.questions); setBankLoading(false); })
      .catch(e => { if (!controller.signal.aborted) { setError(e.message); setBankLoading(false); } });
    return () => controller.abort();
  }, [bankId, revision]);
  useEffect(() => {
    if (preview) previewSection.current?.focus();
  }, [preview]);
  useEffect(() => {
    keyboard.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function invalidate() { setPreview(null); setPreviewInput(null); setConfirmStats(false); setConfirmRemoval(false); setNotice(''); }
  function selectBank(value: string) {
    setBankId(value); setBankQuestions([]); setBankLoading(Boolean(value)); setDraft({}); setText(''); setActive(0); setSingle(null); invalidate();
  }
  const duplicate = (q: AdminQuestion) => bankQuestions.filter(item => item.question_number === q.question_number).length !== 1;
  const editable = (q: AdminQuestion) => !duplicate(q) && !needsManualReview(q);
  function move(delta: number) { setActive(index => Math.max(0, Math.min(bankQuestions.length - 1, index + delta))); }
  function choose(q: AdminQuestion, answer: string) {
    if (busy || !editable(q)) return;
    invalidate(); setDraft(value => ({ ...value, [q.question_number]: answer }));
    const next = bankQuestions.findIndex((item, index) => index > bankQuestions.indexOf(q) && editable(item));
    if (next >= 0) setActive(next);
    keyboard.current?.focus();
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || busy) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); move(event.key === 'ArrowUp' ? -1 : 1); }
    if (/^[a-d]$/i.test(event.key) && bankQuestions[active]) { event.preventDefault(); choose(bankQuestions[active], event.key.toUpperCase()); }
  }
  async function parse(input: AnswerInput) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(''); invalidate();
    try {
      const result = await requestJson<Preview>('/api/admin/questions/bulk-answers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', input }) });
      setPreviewInput(input); setPreview(result);
    } catch (e) { setError(e instanceof Error ? e.message : '預覽失敗'); }
    finally { operation.current = false; setBusy(false); }
  }
  async function apply() {
    if (!preview?.can_apply || !previewInput || operation.current) return;
    operation.current = true; setBusy(true); setError('');
    try {
      const result = await requestJson<{ summary: Preview['summary'] }>('/api/admin/questions/bulk-answers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'apply', input: previewInput, token: preview.token, confirm_statistics: confirmStats, confirm_removal: confirmRemoval }) });
      invalidate(); setDraft({}); setText(''); setSingle(null); setSingleAnswer(''); setBankLoading(Boolean(bankId)); setLoading(true); setRevision(value => value + 1);
      setNotice(`已完成：新增 ${result.summary.added} 題、修改 ${result.summary.changed} 題、相同 ${result.summary.same} 題、略過 ${result.summary.skipped} 題；重算 ${result.summary.recalculate} 筆、清除 ${result.summary.remove} 筆統計。`);
    } catch (e) { invalidate(); setError(e instanceof Error ? e.message : '套用失敗，請重新預覽'); }
    finally { operation.current = false; setBusy(false); }
  }
  const selectedBank = data?.sets.find(bank => bank.id === Number(bankId));
  const statsCount = (preview?.summary.recalculate ?? 0) + (preview?.summary.remove ?? 0);

  return <main className={styles.page}><div className={styles.container}>
    <header className={styles.heading}><div><p>VetExam · 管理員工具</p><h1>題目維護中心</h1><p>檢查答案品質，預覽確認後再套用。</p></div><nav><Link href="/admin">管理後台</Link><Link href="/">首頁</Link></nav></header>
    {error && <div className={styles.warning} role="alert">{error}<button className="study-button" onClick={() => { setError(''); setLoading(true); setRevision(value => value + 1); }}>重新讀取</button></div>}
    {notice && <p className={styles.success} role="status">{notice}</p>}
    {data && <><section className={styles.summary} aria-label="全部題庫資料品質">
      {([['全部題目', data.summary.total], ['缺少正確答案', data.summary.missing_answer], ['缺少官方詳解', data.summary.missing_explanation], ['答案與詳解皆缺少', data.summary.missing_both]] as const).map(([title, count]) => <div className={styles.card} key={title}><p>{title}</p><strong>{count}</strong></div>)}
    </section><p className={styles.muted}>所有公開與私人題庫：NULL {data.summary.answer_null} 題、空白 {data.summary.answer_blank} 題、非 A–D 答案 {data.summary.invalid} 題。</p></>}

    <section className={styles.card} aria-labelledby="bulk-title"><h2 id="bulk-title">批次輸入答案</h2>
      <fieldset disabled={busy}><label className={styles.field}>選擇特定題庫<select value={bankId} onChange={event => selectBank(event.target.value)}><option value="">請先選擇題庫</option>{data?.sets.map(bank => <option key={bank.id} value={bank.id}>{bank.name} · #{bank.id} · {bank.visibility === 'public' ? '公開' : '私人'}</option>)}</select></label>
        {selectedBank && <p className={styles.bankInfo}>{formatExamYear(selectedBank.exam_year)}｜{selectedBank.exam_subject}｜共 {selectedBank.total} 題 · 已有答案 {selectedBank.total - selectedBank.missing_answer} · 缺少答案 {selectedBank.missing_answer} · 已有解析 {selectedBank.total - selectedBank.missing_explanation} · 缺少解析 {selectedBank.missing_explanation}</p>}
        <div className={styles.actions} role="group" aria-label="答案輸入模式">{(['keyboard', 'table', 'sequence'] as const).map((value, index) => <button className="study-button" type="button" key={value} aria-pressed={mode === value} onClick={() => { setMode(value); invalidate(); }}>{['鍵盤快速輸入', '貼上答案表', '連續答案字串'][index]}</button>)}</div>
        {bankLoading ? <p role="status">載入題庫中…</p> : bankId && bankQuestions.length > 0 && <>
          {mode === 'keyboard' ? <>
            <p className={styles.muted}>點選下方輸入區後，按 A/B/C/D 自動跳下一個可編輯題；↑/↓ 移動，也可點題號修正。只套用本次輸入的答案。</p>
            <div className={styles.actions}><button className="study-button" onClick={() => { move(-1); keyboard.current?.focus(); }} disabled={active === 0}>上一題</button><span aria-live="polite">目前：第 {bankQuestions[active]?.question_number} 題</span><button className="study-button" onClick={() => { move(1); keyboard.current?.focus(); }} disabled={active === bankQuestions.length - 1}>下一題</button><button className="study-button" onClick={() => keyboard.current?.focus()}>開始鍵盤輸入</button></div>
            <div ref={keyboard} className={styles.keyboard} tabIndex={0} onKeyDown={keyDown} role="group" aria-label="鍵盤快速輸入區">{bankQuestions.map((q, index) => <div key={q.id} data-active={index === active} className={styles.answerRow}>
              <button onClick={() => { setActive(index); keyboard.current?.focus(); }} aria-label={`前往第 ${q.question_number} 題，ID ${q.id}`}>第 {q.question_number} 題</button><span className={styles.muted}>原：{normalizeAnswer(q.answer) || '尚未設定'}</span>
              {editable(q) ? <div className={styles.choices}>{['A', 'B', 'C', 'D'].map(letter => <button key={letter} onClick={() => { setActive(index); choose(q, letter); }} aria-label={`第 ${q.question_number} 題 ${letter}`} aria-pressed={draft[q.question_number] === letter}>{letter}</button>)}<button aria-label={`清除第 ${q.question_number} 題草稿`} onClick={() => { invalidate(); setDraft(value => { const next = { ...value }; delete next[q.question_number]; return next; }); }}>清除</button></div> : <span className={styles.warningText}>{duplicate(q) ? '題號重複，請以單題 ID 編輯' : '此題答案格式需要人工確認'}</span>}
            </div>)}</div>
          </> : <label className={styles.field}>{mode === 'table' ? '每行一題，支援 1 A、1.A、1、A、1:A 與 Tab' : `依第 1–${bankQuestions.length} 題順序輸入，題號必須連續且不重複`}<textarea rows={7} value={text} onChange={event => { setText(event.target.value); invalidate(); }} placeholder={mode === 'table' ? '1 A\n2 C\n3 B' : 'ACBD…'} maxLength={20000} />{mode === 'sequence' && <span className={text.replace(/\s/g, '').length !== bankQuestions.length ? styles.warningText : styles.muted}>預期 {bankQuestions.length} 題 · 實際輸入 {text.replace(/\s/g, '').length} 個答案；數量不符禁止套用。</span>}</label>}
          <button className="study-button study-button-primary" onClick={() => parse({ question_set_id: Number(bankId), mode, ...(mode === 'keyboard' ? { answers: Object.entries(draft).map(([number, answer]) => ({ question_number: Number(number), answer })) } : { text }) })}>解析預覽</button>
        </>}
      </fieldset>
    </section>

    <section className={styles.card}><h2>搜尋與單題編輯</h2><form onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget); const params = new URLSearchParams();
      for (const [key, value] of form.entries()) if (String(value).trim()) params.set(key, String(value).trim());
      setLoading(true); setPage(1); setQuery(params.toString()); setRevision(value => value + 1);
    }}><fieldset disabled={busy} className={styles.filters}>
      <label className={styles.field}>題目 ID<input name="id" type="number" min="1" /></label><label className={styles.field}>題號<input name="number" type="number" min="1" /></label>
      <label className={styles.field}>年份<select name="year"><option value="">全部年份</option>{[...new Set(data?.sets.map(s => s.exam_year).filter((year): year is number => year !== null))].map(year => <option key={year} value={year}>{formatExamYear(year)}</option>)}</select></label>
      <label className={styles.field}>科目<input name="subject" list="admin-subjects" placeholder="完整科目名稱" /><datalist id="admin-subjects">{[...new Set(data?.sets.map(s => s.exam_subject))].filter(Boolean).map(subject => <option key={subject} value={subject} />)}</datalist></label>
      <label className={styles.field}>題庫<select name="question_set_id"><option value="">全部題庫</option>{data?.sets.map(bank => <option key={bank.id} value={bank.id}>{bank.name} · #{bank.id}</option>)}</select></label>
      <label className={styles.field}>資料品質<select name="quality"><option value="all">全部</option><option value="missing_answer">缺少答案</option><option value="has_answer">已有答案</option><option value="missing_explanation">缺少官方詳解</option><option value="has_explanation">已有官方詳解</option><option value="invalid">非 A–D 答案</option></select></label>
      <label className={styles.field}>題目關鍵字<input name="keyword" type="search" maxLength={200} /></label><button className="study-button" type="submit">搜尋題目</button>
    </fieldset></form>
      {loading ? <p role="status">載入中…</p> : <><p className={styles.muted}>共 {data?.total ?? 0} 題 · 第 {page} 頁（每頁 100 題）</p><div className={styles.tableScroll}><table><thead><tr><th>ID／題號</th><th>年份／題庫</th><th>題目</th><th>正確答案</th><th>操作</th></tr></thead><tbody>{data?.questions.map(q => <tr key={q.id}><td>#{q.id}<br />第 {q.question_number} 題</td><td>{formatExamYear(q.exam_year ?? null)}<br />{q.subject}<br />{q.question_set_name}</td><td>{q.question.slice(0, 110)}</td><td className={!normalizeAnswer(q.answer) ? styles.warningText : undefined}>{normalizeAnswer(q.answer) || '尚未設定'}</td><td><button className="study-button" disabled={busy} onClick={() => { setSingle(q); setSingleAnswer(/^[A-D]$/.test(normalizeAnswer(q.answer)) ? normalizeAnswer(q.answer) : ''); invalidate(); }}>查看／編輯</button></td></tr>)}</tbody></table></div>
        {!data?.questions.length && <p>沒有符合的題目。</p>}
        <div className={styles.actions}><button className="study-button" disabled={page === 1 || busy} onClick={() => { setLoading(true); setPage(p => p - 1); }}>上一頁</button><button className="study-button" disabled={page * 100 >= (data?.total ?? 0) || busy} onClick={() => { setLoading(true); setPage(p => p + 1); }}>下一頁</button></div></>}
    </section>

    {single && <section className={styles.card} aria-label="單題編輯"><h2>單題編輯 · ID {single.id} · 第 {single.question_number} 題</h2><p>{formatExamYear(single.exam_year ?? null)}｜{single.subject}｜{single.question_set_name}</p><p className={styles.question}>{single.question}</p>
      {[single.option_a, single.option_b, single.option_c, single.option_d, single.option_e].map((option, index) => option && <p className={styles.question} key={index}>{String.fromCharCode(65 + index)}. {option}</p>)}
      <p className={!normalizeAnswer(single.answer) ? styles.warningText : undefined}>正確答案：{single.answer?.trim() || '尚未設定'}</p><h3>官方詳解</h3><p className={styles.question}>{single.explanation || '尚未提供'}</p>
      {needsManualReview(single) ? <p className={styles.warningText}>此題答案格式需要人工確認，V1 不覆蓋此題。</p> : <fieldset disabled={busy}><label className={styles.field}>新的正確答案<select value={singleAnswer} onChange={event => { setSingleAnswer(event.target.value); invalidate(); }}><option value="">請選擇</option>{['A', 'B', 'C', 'D'].map(letter => <option key={letter}>{letter}</option>)}</select></label><button className="study-button" onClick={() => parse({ mode: 'single', question_set_id: single.question_set_id, question_id: single.id, answer: singleAnswer })}>預覽單題修改</button></fieldset>}
      <button className="study-button" disabled={busy} onClick={() => { setSingle(null); invalidate(); }}>關閉單題</button>
    </section>}

    {preview && <section ref={previewSection} tabIndex={-1} className={styles.card} aria-labelledby="preview-title"><h2 id="preview-title">解析預覽與確認</h2>
      <p>成功解析：{preview.parsed} 題 · 無法解析：{preview.errors.length} · 無法匹配：{preview.summary.unmatched}</p>
      <p>新增答案：{preview.summary.added} · 修改答案：{preview.summary.changed} · 答案相同：{preview.summary.same} · 略過：{preview.summary.skipped}</p>
      {preview.errors.length > 0 && <ul className={styles.warning} role="alert">{preview.errors.map((message, i) => <li key={i}>{message}</li>)}</ul>}
      <div className={styles.tableScroll}><table><thead><tr><th>題號／ID</th><th>原答案</th><th>新答案</th><th>狀態</th><th>統計影響</th></tr></thead><tbody>{preview.rows.map((row, i) => <tr key={i} className={row.status === 'changed' ? styles.conflict : undefined}><td>{row.question_number}／{row.question_id ?? '—'}</td><td>{row.old_answer?.trim() || '尚未設定'}</td><td>{row.new_answer}</td><td><strong>{labels[row.status]}</strong>{row.reason && <p>{row.reason}</p>}{row.status === 'changed' && <p>原答案與新答案不同</p>}</td><td>重算 {row.recalculate} 筆<br />清除 {row.remove} 筆</td></tr>)}</tbody></table></div>
      {statsCount > 0 && <div className={styles.warning}><p>受影響題目已有 {statsCount} 筆作答紀錄。修改答案會同步更新正確率與答錯排行榜。</p><p>可重新計算：{preview.summary.recalculate} 筆；無法重新計算：{preview.summary.remove} 筆。</p><label><input type="checkbox" checked={confirmStats} disabled={busy} onChange={event => setConfirmStats(event.target.checked)} /> 我確認套用答案並重新計算歷史統計。</label>{preview.summary.remove > 0 && <label><input type="checkbox" checked={confirmRemoval} disabled={busy} onChange={event => setConfirmRemoval(event.target.checked)} /> 我確認清除 {preview.summary.remove} 筆缺少或無效選項的舊紀錄，之後從新作答重新累積；此清除無法復原。</label>}</div>}
      <p className={styles.muted}>相同答案不更新；特殊題目會略過。預覽有效 15 分鐘，題目或統計變動時需重新預覽。</p>
      <div className={styles.actions}><button className="study-button study-button-primary" disabled={busy || !preview.can_apply || (statsCount > 0 && !confirmStats) || (preview.summary.remove > 0 && !confirmRemoval)} onClick={apply}>確認套用答案</button><button className="study-button" disabled={busy} onClick={invalidate}>取消預覽</button></div>
    </section>}
    {busy && <p role="status">處理中，請稍候…</p>}
  </div></main>;
}
