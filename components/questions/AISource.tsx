import type { AISource as Source } from '@/lib/ai-question-input';
export default function AISource({ source }: { source: Source }) {
  return <section aria-label="教材來源" className="mt-5 break-words">
    <h2 className="font-semibold">教材來源</h2>
    <dl className="grid gap-2 text-sm">
      <div><dt className="inline font-semibold">書名／講義名：</dt><dd className="inline">{source.title}</dd></div>
      <div><dt className="inline font-semibold">版本：</dt><dd className="inline">{source.edition || '未提供／未確認'}</dd></div>
      <div><dt className="inline font-semibold">來源章節：</dt><dd className="inline">{source.chapter || '未提供／未確認'}</dd></div>
      <div><dt className="inline font-semibold">書本印刷頁碼：</dt><dd className="inline">{source.printedPages || '未提供／未確認'}</dd></div>
      <div><dt className="inline font-semibold">PDF 頁次：</dt><dd className="inline">{source.pdfPages || '未提供／未確認'}</dd></div>
    </dl>
    <p className="mt-3 whitespace-pre-wrap">來源摘錄：{source.excerpt}</p>
    {source.url && <a className="study-button mt-3" href={source.url} target="_blank" rel="noopener noreferrer">開啟管理員提供的公開來源</a>}
  </section>;
}
