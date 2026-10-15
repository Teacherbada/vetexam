"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./foundation-pdf.module.css";

type ReviewStatus = { confidence: number; warnings: string[] };
type ReviewQuestion = {
  id: number;
  questionNumber?: number;
  question: string;
  options: string[];
  answer: string;
  pageNumber?: number;
  hasImage?: boolean;
  imageDataUrl?: string | null;
  reviewed?: boolean;
};

type Filter = "全部" | "需要確認" | "圖片題" | "已確認";

function reviewLabel(question: ReviewQuestion, status: ReviewStatus) {
  if (question.reviewed) return { label: "已人工確認", tone: "bg-[#E9F2ED] text-[#3F725F]" };
  if (status.confidence < 70) return { label: "明顯異常", tone: "bg-[#FBECEC] text-[#A44747]" };
  if (status.confidence < 90 || status.warnings.length) return { label: "需要確認", tone: "bg-[#FBF3DF] text-[#80652C]" };
  return { label: "自動檢查通過", tone: "bg-[#EEF0EE] text-[#59645F]" };
}

export default function ImportReviewWorkbench({
  file,
  questions,
  getStatus,
  onOpenEditor,
  onToggleReviewed,
}: {
  file: File | null;
  questions: ReviewQuestion[];
  getStatus: (question: ReviewQuestion) => ReviewStatus;
  onOpenEditor: (id: number) => void;
  onToggleReviewed: (id: number) => void;
}) {
  const [filter, setFilter] = useState<Filter>("需要確認");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pdfUrl, setPdfUrl] = useState("");

  useEffect(() => {
    if (!file) {
      setPdfUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const rows = useMemo(
    () => questions.map((question) => ({ question, status: getStatus(question) })),
    [questions, getStatus],
  );

  const counts = useMemo(() => {
    let pass = 0;
    let review = 0;
    let error = 0;
    let images = 0;
    for (const row of rows) {
      if (row.question.hasImage) images += 1;
      if (row.question.reviewed) continue;
      if (row.status.confidence < 70) error += 1;
      else if (row.status.confidence < 90 || row.status.warnings.length) review += 1;
      else pass += 1;
    }
    return { pass, review, error, images };
  }, [rows]);

  const visible = useMemo(
    () =>
      rows.filter(({ question, status }) => {
        if (filter === "需要確認") return !question.reviewed && (status.confidence < 90 || status.warnings.length > 0);
        if (filter === "圖片題") return !!question.hasImage;
        if (filter === "已確認") return !!question.reviewed;
        return true;
      }),
    [rows, filter],
  );

  useEffect(() => {
    if (!visible.length) {
      setSelectedId(null);
      return;
    }
    if (selectedId === null || !visible.some(({ question }) => question.id === selectedId)) {
      setSelectedId(visible[0].question.id);
    }
  }, [visible, selectedId]);

  const selected = rows.find(({ question }) => question.id === selectedId) ?? null;
  const pageNumber = selected?.question.pageNumber ?? 1;
  const pageSrc = pdfUrl ? `${pdfUrl}#page=${pageNumber}&zoom=page-width` : "";

  return (
    <section className={styles.card} aria-label="快速檢查工作台">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-bold text-[#26332E]">快速檢查工作台</h3>
            <span className="rounded-full bg-[#E9F2ED] px-2.5 py-1 text-xs font-bold text-[#3F725F]">試行版</span>
          </div>
          <p className="mt-2 text-sm text-[#6F7873]">
            先看整份題庫，只處理被規則標記的題目；點選題目後可直接和原 PDF 對照。
          </p>
        </div>
        <p className="max-w-xl text-xs leading-5 text-[#6F7873]">
          「自動檢查通過」只代表目前沒有偵測到結構或圖片規則異常，不代表內容一定 100% 正確。
        </p>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <button type="button" onClick={() => setFilter("全部")} className="rounded-xl border border-[#E8EBE8] bg-white p-4 text-left">
          <span className="text-xs font-semibold text-[#6F7873]">全部題目</span>
          <strong className="mt-1 block text-2xl text-[#26332E]">{questions.length}</strong>
        </button>
        <button type="button" onClick={() => setFilter("需要確認")} className="rounded-xl border border-[#F0DEB4] bg-[#FFF9EC] p-4 text-left">
          <span className="text-xs font-semibold text-[#80652C]">需要人工確認</span>
          <strong className="mt-1 block text-2xl text-[#80652C]">{counts.review + counts.error}</strong>
          <small className="mt-1 block text-[#80652C]">其中明顯異常 {counts.error} 題</small>
        </button>
        <button type="button" onClick={() => setFilter("圖片題")} className="rounded-xl border border-[#D8E4DC] bg-[#F4F8F5] p-4 text-left">
          <span className="text-xs font-semibold text-[#3F725F]">圖片候選</span>
          <strong className="mt-1 block text-2xl text-[#3F725F]">{counts.images}</strong>
        </button>
        <div className="rounded-xl border border-[#E8EBE8] bg-[#FAFAF7] p-4">
          <span className="text-xs font-semibold text-[#6F7873]">自動檢查通過</span>
          <strong className="mt-1 block text-2xl text-[#59645F]">{counts.pass}</strong>
          <small className="mt-1 block text-[#6F7873]">仍建議匯入前抽查</small>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {(["全部", "需要確認", "圖片題", "已確認"] as Filter[]).map((item) => (
          <button
            type="button"
            key={item}
            onClick={() => setFilter(item)}
            aria-pressed={filter === item}
            className={filter === item ? styles.primary : styles.secondary}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <div className="min-w-0 overflow-hidden rounded-xl border border-[#E8EBE8] bg-white">
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="sticky top-0 z-10 bg-[#F7F8F5] text-xs text-[#6F7873]">
                <tr>
                  <th className="px-3 py-3">題號</th>
                  <th className="px-3 py-3">題目</th>
                  <th className="px-3 py-3">答案</th>
                  <th className="px-3 py-3">圖片</th>
                  <th className="px-3 py-3">狀態</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ question, status }) => {
                  const meta = reviewLabel(question, status);
                  const selectedRow = question.id === selectedId;
                  return (
                    <tr
                      key={question.id}
                      className={`cursor-pointer border-t border-[#EEF0EE] ${selectedRow ? "bg-[#F0F6F2]" : "hover:bg-[#FAFAF7]"}`}
                      onClick={() => setSelectedId(question.id)}
                    >
                      <td className="whitespace-nowrap px-3 py-3 font-bold text-[#3F725F]">{question.questionNumber ?? question.id}</td>
                      <td className="max-w-[420px] px-3 py-3 text-[#26332E]">
                        <span className="line-clamp-2">{question.question || "尚未辨識題幹"}</span>
                        {!!status.warnings.length && <small className="mt-1 block text-[#A44747]">{status.warnings.join(" · ")}</small>}
                      </td>
                      <td className="px-3 py-3 font-bold text-[#26332E]">{question.answer || "—"}</td>
                      <td className="px-3 py-3">{question.hasImage ? "🖼 候選" : "—"}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${meta.tone}`}>{meta.label}</span>
                      </td>
                    </tr>
                  );
                })}
                {!visible.length && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-[#6F7873]">這個篩選目前沒有題目。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="min-w-0 rounded-xl border border-[#E8EBE8] bg-[#FAFAF7] p-4">
          {!selected ? (
            <p className="py-10 text-center text-sm text-[#6F7873]">從左側選一題開始對照。</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-[#6F7873]">PDF 左右對照</p>
                  <h4 className="text-lg font-bold text-[#26332E]">第 {selected.question.questionNumber ?? selected.question.id} 題 · 第 {pageNumber} 頁</h4>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${reviewLabel(selected.question, selected.status).tone}`}>
                  {reviewLabel(selected.question, selected.status).label}
                </span>
              </div>

              <div className="overflow-hidden rounded-xl border border-[#DDE3DF] bg-white">
                {pageSrc ? (
                  <iframe
                    key={pageSrc}
                    title={`第 ${selected.question.questionNumber ?? selected.question.id} 題原始 PDF`}
                    src={pageSrc}
                    className="h-[360px] w-full bg-white"
                  />
                ) : (
                  <div className="flex h-[220px] items-center justify-center text-sm text-[#6F7873]">原始 PDF 目前不可用。</div>
                )}
              </div>

              <div className="rounded-xl border border-[#E8EBE8] bg-white p-4">
                <p className="whitespace-pre-wrap font-semibold leading-7 text-[#26332E]">{selected.question.question || "尚未辨識題幹"}</p>
                <div className="mt-3 space-y-2 text-sm text-[#59645F]">
                  {selected.question.options.map((option, index) => (
                    <p key={index}><b>{String.fromCharCode(65 + index)}.</b> {option || "（空白）"}</p>
                  ))}
                </div>
                <p className="mt-3 text-sm font-bold text-[#3F725F]">答案：{selected.question.answer || "未知／留空"}</p>
                {selected.question.hasImage && (
                  <div className="mt-3 rounded-lg bg-[#FFF9EC] p-3 text-sm text-[#80652C]">
                    🖼 系統偵測到圖片候選。圖片仍維持延遲載入；請展開完整編輯後再確認實際裁切內容。
                  </div>
                )}
                {!!selected.status.warnings.length && (
                  <div className="mt-3 rounded-lg bg-[#FBECEC] p-3 text-sm text-[#A44747]">
                    需要注意：{selected.status.warnings.join(" · ")}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" className={styles.primary} onClick={() => onOpenEditor(selected.question.id)}>
                  展開完整編輯
                </button>
                <button type="button" className={styles.secondary} onClick={() => onToggleReviewed(selected.question.id)}>
                  {selected.question.reviewed ? "取消人工確認" : "標記已人工確認"}
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
