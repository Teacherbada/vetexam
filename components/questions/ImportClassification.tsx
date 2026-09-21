'use client';

import { chapterGroups } from '@/data/exam-chapters';
import { CHAPTER_CONFIDENCE_THRESHOLD, type ClassificationQuestion, type ChapterReview } from '@/lib/chapter-classification';
import type { useImportClassification } from './useImportClassification';
import styles from '@/app/pdf/pdf.module.css';

type State = ReturnType<typeof useImportClassification>;
export default function ImportClassification({ subject, questions, state, disabled = false }: {
  subject: string; questions: ClassificationQuestion[]; state: State; disabled?: boolean;
}) {
  const groups = chapterGroups(subject);
  const high = state.rows?.flatMap((row, index) => row.suggestedChapter && row.confidence >= CHAPTER_CONFIDENCE_THRESHOLD ? [index] : []) ?? [];
  const low = state.rows?.flatMap((row, index) => row.suggestedChapter && row.confidence < CHAPTER_CONFIDENCE_THRESHOLD ? [index] : []) ?? [];
  const missing = state.rows?.flatMap((row, index) => !row.suggestedChapter ? [index] : []) ?? [];
  function options() { return groups.map((group, i) => <optgroup key={i} label={group.label || subject}>{group.chapters.map(chapter => <option key={chapter}>{chapter}</option>)}</optgroup>); }
  function renderQuestion(index: number) {
    const row = state.rows![index] as ChapterReview, question = questions[index];
    return <article key={index} className={`${styles.status} min-w-0 [overflow-wrap:anywhere]`} aria-label={`第 ${index + 1} 題分類`}>
      <h3 className="font-bold">第 {index + 1} 題{row.reviewed ? ' · 已確認' : ''}</h3>
      <p className="mt-3 whitespace-pre-wrap">{question.question}</p>
      <details className="mt-3"><summary className="cursor-pointer">查看選項、答案與解析</summary>
        {question.options.map((option, i) => <p key={i} className="mt-2 whitespace-pre-wrap">{String.fromCharCode(65 + i)}. {option}</p>)}
        <p className="mt-2">正確答案：{question.answer || '尚未設定'}</p><p className="mt-2 whitespace-pre-wrap">{question.explanation}</p>
      </details>
      <p className="mt-3">AI 建議：{row.suggestedChapter || '尚未分類'} · 信心：{Math.round(row.confidence * 100)}%</p>
      <p className="mt-2">第二候選：{row.secondChoice || '無'}</p><p className="mt-2">判斷理由：{row.reason}</p>
      <p className="mt-2 font-semibold">將儲存：{row.chapter || '尚未分類'}</p>
      <label className={`${styles.field} mt-3`}>修改第 {index + 1} 題章節<select value={row.chapter || ''} onChange={e => state.review(index, e.target.value || null)} className="w-full min-w-0 max-w-full rounded-xl border bg-white p-3">
        <option value="">尚未分類</option>{options()}</select></label>
      <div className={styles.actions}>
        {row.suggestedChapter && <button type="button" className={styles.primary} onClick={() => state.review(index, row.suggestedChapter)}>接受 AI 建議</button>}
        <button type="button" className={styles.secondary} onClick={() => state.review(index, null)}>暫不分類</button>
      </div>
    </article>;
  }
  return <section className={`${styles.card} ${styles.content} min-w-0 max-w-full`} aria-label="匯入章節分類">
    <h2>章節分類</h2>
    <fieldset disabled={disabled || state.busy} className="mt-4 min-w-0">
      <label className={styles.field}>分類方式<select value={state.mode} onChange={e => state.setMode(e.target.value as State['mode'])} className="w-full min-w-0 rounded-xl border bg-white p-3">
        <option value="ai">AI 自動分類（推薦）</option><option value="same">整份題庫指定相同章節</option><option value="later">稍後分類</option>
      </select></label>
      {state.mode === 'same' && <label className={`${styles.field} mt-4`}>整份題庫章節<select value={state.selectedChapter} onChange={e => state.setSameChapter(e.target.value)} className="w-full min-w-0 rounded-xl border bg-white p-3"><option value="">請選擇章節</option>{options()}</select></label>}
      {state.mode === 'later' && <p className="mt-3 text-sm text-[#6F7873]">本次題目將保持未分類，仍可正常匯入。</p>}
      {state.mode === 'ai' && <>
        <p className="mt-3 text-sm text-[#6F7873]">依官方章節逐題分類。低於 90% 需人工確認，高信心題目也可查看與修改。AI 分類目前限管理員使用。</p>
        {!groups.length && <p className={styles.warning}>請先選擇官方國考科目，或選擇稍後分類。</p>}
        <div className={styles.actions}><button type="button" disabled={!groups.length || !questions.length || state.busy} onClick={state.classify} className={styles.primary}>{state.rows ? '重新分類（取代目前確認結果）' : '開始 AI 章節分類'}</button></div>
        {state.rows && <>
          <p className={styles.status}>AI 章節分類完成 · 共 {questions.length} 題<br />高信心分類：{high.length} 題 · 需確認建議：{low.length} 題 · 未取得建議：{missing.length} 題<br />待人工確認：{state.pending} 題 · 目前尚未分類：{state.rows.filter(row => !row.chapter).length} 題</p>
          <p className="mt-3 text-sm text-[#6F7873]">請查看分類結果，再按原頁面的儲存按鈕完成匯入。未取得建議的題目可保留未分類。</p>
          <details open className="mt-4"><summary className="cursor-pointer font-semibold">查看需要確認的題目（{low.length + missing.length}）</summary>{[...low, ...missing].sort((a, b) => a - b).map(renderQuestion)}</details>
          <details className="mt-4"><summary className="cursor-pointer font-semibold">高信心分類 {high.length} 題 · 展開查看</summary>{high.map(renderQuestion)}</details>
        </>}
      </>}
    </fieldset>
    {state.mode === 'ai' && state.busy && <p role="status" aria-live="polite" className={styles.status}>{state.progress}</p>}
  </section>;
}
