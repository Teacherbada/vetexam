'use client';

import { useEffect, useRef, useState } from 'react';
import { REVIEW_LABELS, reviewState, type ReviewAssessment } from './import-review';
import styles from './foundation-pdf.module.css';
import workbench from './import-review.module.css';

type Question = {
  id: number; questionNumber?: number; question: string; options: string[];
  answer: string; pageNumber?: number; endPage?: number; hasImage?: boolean; reviewed?: boolean;
};
type Filter = 'needs-review' | 'all' | 'images' | 'reviewed';
const filters: { value: Filter; label: string }[] = [
  { value: 'all', label: '全部' }, { value: 'needs-review', label: '需要確認' },
  { value: 'images', label: '圖片題' }, { value: 'reviewed', label: '已確認' },
];

// Only mounted after a question is selected. The browser displays the original
// local PDF; no page rasterization, image extraction or upload is performed here.
function PdfSource({ file, page }: { file: File; page: number }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const link = useRef<HTMLAnchorElement>(null);
  const source = useRef<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    source.current = url;
    return () => { URL.revokeObjectURL(url); source.current = null; };
  }, [file]);
  useEffect(() => {
    const url = `${source.current}#page=${page}`;
    if (frame.current) frame.current.src = url;
    if (link.current) link.current.href = url;
  }, [file, page]);
  return <>
    <p className={workbench.hint}>若瀏覽器未顯示或未跳頁，可<a ref={link} target="_blank" rel="noopener noreferrer">在新分頁開啟原 PDF</a>，前往第 {page} 頁。</p>
    <iframe ref={frame} key={page} title={`原始 PDF 第 ${page} 頁`} className={workbench.pdf} />
  </>;
}

export default function ImportReviewWorkbench<T extends Question>({ questions, file, assess, onEdit, onReview }: {
  questions: T[]; file: File | null; assess: (question: T) => ReviewAssessment;
  onEdit: (id: number) => void; onReview: (id: number) => void;
}) {
  const [filter, setFilter] = useState<Filter>('needs-review');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const rows = questions.map(question => {
    const assessment = assess(question);
    return { question, assessment, state: reviewState(assessment, question.reviewed) };
  });
  const pending = rows.filter(row => row.state === 'needs-review' || row.state === 'anomaly');
  const visible = rows.filter(row => filter === 'all' || (filter === 'images' ? row.question.hasImage :
    filter === 'reviewed' ? row.state === 'reviewed' : row.state === 'needs-review' || row.state === 'anomaly'));
  // Keep the inspected question visible after confirmation, even if it leaves
  // the pending list. Deleting a question naturally clears the comparison.
  const selected = rows.find(row => row.question.id === selectedId);
  const q = selected?.question;
  const page = q?.pageNumber && Number.isInteger(q.pageNumber) && q.pageNumber > 0 ? q.pageNumber : null;
  const stats = [
    ['全部題目數', rows.length], ['自動檢查通過', rows.filter(row => row.state === 'passed').length],
    ['需要人工確認', pending.length], ['明顯異常', rows.filter(row => row.state === 'anomaly').length],
    ['圖片候選', rows.filter(row => row.question.hasImage).length],
  ] as const;
  function select(id: number) { setSelectedId(id); }
  return <section className={`${styles.card} ${workbench.root}`} aria-labelledby="review-workbench-title">
    <h3 id="review-workbench-title">快速檢查工作台</h3>
    <p id="review-workbench-note" className={workbench.hint}>自動檢查通過只代表目前沒有偵測到格式或圖片規則異常，不代表內容一定 100% 正確。</p>
    <dl className={`${styles.summary} ${workbench.stats}`}>{stats.map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
    <p className={workbench.hint}>「需要人工確認」包含明顯異常；圖片候選可與其他狀態重疊。</p>
    <div className={workbench.filters} role="group" aria-label="快速檢查篩選">{filters.map(item =>
      <button key={item.value} type="button" className={filter === item.value ? styles.primary : styles.secondary} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}</div>
    <p className={workbench.hint} role="status">顯示 {visible.length} / {rows.length} 題</p>
    {visible.length ? <div className={workbench.tableScroll} tabIndex={0} role="region" aria-label="題目總覽表，可捲動">
      <table className={workbench.table} aria-describedby="review-workbench-note"><caption className="sr-only">解析題目快速檢查</caption>
        <thead><tr><th scope="col">題號</th><th scope="col">題目摘要</th><th scope="col">正確答案</th><th scope="col">圖片</th><th scope="col">狀態</th></tr></thead>
        <tbody>{visible.map(({ question, assessment, state }) => <tr key={question.id} data-selected={question.id === selectedId} onClick={() => select(question.id)}>
          <th scope="row"><button type="button" className={workbench.questionLink} aria-label={`對照第 ${question.questionNumber ?? question.id} 題原 PDF`} aria-pressed={question.id === selectedId} onClick={() => select(question.id)}>{question.questionNumber ?? question.id}</button></th>
          <td><span className={workbench.snippet}>{question.question || '尚未填寫題幹'}</span></td>
          <td>{question.answer || '—'}</td><td>{question.hasImage ? '🖼 圖片候選' : '—'}</td>
          <td><span className={workbench.state} data-state={state}>{REVIEW_LABELS[state]}</span>{assessment.warnings.length > 0 && <small className={workbench.reason}>{assessment.warnings.join(' · ')}</small>}</td>
        </tr>)}</tbody>
      </table>
    </div> : <p className={workbench.empty}>此篩選下沒有題目。可切換「全部」繼續抽查。</p>}
    {selected && q ? <section className={workbench.comparison} aria-label={`第 ${q.questionNumber ?? q.id} 題 PDF 對照`}>
      <div className={workbench.source}><h4>原始 PDF{page ? ` · 第 ${page} 頁` : ''}</h4>
        {page && q.endPage && q.endPage > page && <p className={workbench.hint}>此題跨至第 {q.endPage} 頁，請一併檢查後續頁面。</p>}
        {file && page ? <PdfSource file={file} page={page} /> : <p className={workbench.empty}>{!file ? '目前沒有原 PDF，可使用完整編輯檢查內容。' : '此題沒有來源頁碼，請開啟其他題目的原 PDF 或使用完整編輯。'}</p>}
      </div>
      <div className={workbench.result}><h4>解析結果 · 第 {q.questionNumber ?? q.id} 題</h4>
        <p><span className={workbench.state} data-state={selected.state}>{REVIEW_LABELS[selected.state]}</span></p>
        <p className={workbench.hint}>格式檢查分數：{selected.assessment.confidence}（非內容正確率）</p>
        <p className={workbench.stem}>{q.question || '尚未填寫題幹'}</p>
        <ul className={workbench.options}>{q.options.map((option, index) => <li key={index}><b>{String.fromCharCode(65 + index)}.</b> {option || '（缺選項）'}</li>)}</ul>
        <p><strong>正確答案：</strong>{q.answer || '未知／留空'}</p>
        <p className={workbench.hint}>{q.hasImage ? '🖼 圖片候選，請對照原 PDF；裁切預覽與圖片修正在完整編輯中。' : '未標記圖片候選，仍可對照原 PDF 檢查。'}</p>
        {selected.assessment.warnings.length > 0 ? <ul className={workbench.warnings} aria-label="解析警告">{selected.assessment.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : <p className={workbench.hint}>目前沒有偵測到格式或圖片規則異常。</p>}
        <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => onEdit(q.id)}>展開完整編輯</button>
          <button type="button" className={styles.primary} disabled={!!q.reviewed} onClick={() => onReview(q.id)}>{q.reviewed ? '已人工確認' : '標記已人工確認'}</button></div>
        <p className={workbench.hint}>確認後仍可編輯；修改題目內容或圖片後會重新列為未確認。</p>
      </div>
    </section> : <p className={workbench.empty}>點選表格中的題目，即可對照原 PDF 與解析結果。</p>}
  </section>;
}
