"use client";

import { useRef, useState } from "react";
import { buildImportBatches, readImportResponse, type ImportMetadata, type ImportQuestion, type ImportRange } from "@/lib/import-batches";
import styles from "./pdf.module.css";

type Props = {
  enabled: boolean; onEnabled: (enabled: boolean) => void; disabled: boolean;
  metadata: ImportMetadata; questions: (ImportQuestion & { hasImage?: boolean })[];
  onBusy: (busy: boolean) => void; onMessage: (message: string) => void;
  onComplete: (questionSetId: number) => Promise<void>;
};

export default function BatchImportPanel({ enabled, onEnabled, disabled, metadata, questions, onBusy, onMessage, onComplete }: Props) {
  const middle = Math.ceil(questions.length / 2);
  const [ranges, setRanges] = useState<ImportRange[]>(questions.length > 1 ? [{ from: 1, to: middle }, { from: middle + 1, to: questions.length }] : [{ from: 1, to: 1 }]);
  const [progress, setProgress] = useState("");
  const running = useRef(false);
  const run = useRef<{ signature: string; id: string } | null>(null);
  let summary = "";
  let validationError = "";
  try {
    const preview = buildImportBatches(metadata, questions, ranges, "00000000-0000-4000-8000-000000000000");
    summary = preview.map((batch, index) => `第 ${index + 1} 批：約 ${(batch.bytes / 1_000_000).toFixed(2)} MB`).join(" · ");
  } catch (error) { validationError = (error as Error).message; }

  async function start() {
    if (running.current) return;
    running.current = true; onBusy(true);
    try {
      const incomplete = questions.findIndex((question) => !question.question.trim() || question.options.length < 4 || question.options.some((option) => !option.trim()));
      if (incomplete >= 0) throw new Error(`第 ${incomplete + 1} 題尚未填寫完整，請先檢查題目與選項。`);
      const missingImage = questions.findIndex((question) => question.hasImage && !question.imageDataUrl);
      if (missingImage >= 0) throw new Error(`第 ${missingImage + 1} 題圖片尚未載入，請捲動到該題預覽，或手動補圖／移除圖片後再匯入。`);
      const preview = buildImportBatches(metadata, questions, ranges, "00000000-0000-4000-8000-000000000000");
      const signature = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(preview.map((batch) => batch.body).join("\n"))))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
      if (run.current?.signature !== signature) run.current = { signature, id: crypto.randomUUID() };
      const batches = buildImportBatches(metadata, questions, ranges, run.current.id);
      for (let index = 0; index < batches.length; index++) {
        const message = `正在匯入第 ${index + 1} / ${batches.length} 批（第 ${ranges[index].from}–${ranges[index].to} 題）…`;
        setProgress(message); onMessage(message);
        const response = await fetch("/api/question-sets/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: batches[index].body, signal: AbortSignal.timeout(60000) });
        const result = await readImportResponse(response);
        if (result.complete) {
          if (!Number.isInteger(result.questionSetId) || Number(result.questionSetId) < 1) throw new Error("題庫回應不完整，請重試。");
          await onComplete(Number(result.questionSetId));
          return;
        }
      }
      throw new Error("尚未收到完整匯入確認，請重試；系統不會重複建立題目。");
    } catch (error) {
      const message = `${error instanceof Error ? error.message : "分批匯入失敗"} 題目仍保留；可調整設定或重試，已收到且內容相同的批次不會重複儲存。`;
      setProgress(message); onMessage(message);
    } finally { running.current = false; onBusy(false); }
  }

  return <section className="mt-4 border-t border-[#E8EBE8] pt-4" aria-label="分批匯入設定">
    <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-[#3F725F]"><input type="checkbox" checked={enabled} disabled={disabled} onChange={(event) => onEnabled(event.target.checked)} />分批匯入</label>
    {enabled && <>
      <p className="mt-2 text-sm text-[#6F7873]">上傳一次 PDF，依下方畫面題號設定每批範圍。系統依序送出，全部完成後合併為同一份題庫，題號不重新從 1 開始。</p>
      <div className="mt-3 space-y-3">{ranges.map((range, index) => <div key={index} className="rounded-xl border border-[#E8EBE8] bg-[#FAFAF7] p-3">
        <p className="text-sm font-semibold">第 {index + 1} 批</p><div className="mt-2 grid grid-cols-2 gap-3">
          <label className="min-w-0 text-sm">從第幾題<input aria-label={`第 ${index + 1} 批起始題號`} disabled={disabled} type="number" min={1} max={questions.length} value={range.from || ""} onChange={(event) => setRanges((current) => current.map((item, i) => i === index ? { ...item, from: Number(event.target.value) } : item))} className="mt-1 w-full min-w-0 rounded-xl border border-[#E8EBE8] bg-white p-3" /></label>
          <label className="min-w-0 text-sm">到第幾題<input aria-label={`第 ${index + 1} 批結束題號`} disabled={disabled} type="number" min={1} max={questions.length} value={range.to || ""} onChange={(event) => setRanges((current) => current.map((item, i) => i === index ? { ...item, to: Number(event.target.value) } : item))} className="mt-1 w-full min-w-0 rounded-xl border border-[#E8EBE8] bg-white p-3" /></label>
        </div>{ranges.length > 1 && <button type="button" disabled={disabled} onClick={() => setRanges((current) => current.filter((_, i) => i !== index))} className={styles.secondary + " mt-2"}>移除第 {index + 1} 批</button>}
      </div>)}</div>
      <div className={styles.actions}><button type="button" disabled={disabled || ranges.length >= 200} onClick={() => setRanges((current) => [...current, { from: (current.at(-1)?.to || 0) + 1, to: questions.length }])} className={styles.secondary}>新增一批</button><button type="button" onClick={start} disabled={disabled || !!validationError} className={styles.primary}>{disabled ? "匯入中…" : "開始分批匯入"}</button></div>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm text-[#6F7873]" role="status">{validationError || summary}</p>
      {progress && <p className={styles.status} role="status">{progress}</p>}
    </>}
  </section>;
}
