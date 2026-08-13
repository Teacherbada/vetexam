"use client";

import { useEffect, useState } from "react";

type Props = {
  file: File | null;
  pageNumber?: number;
  questionNumber: number;
  onImageLoaded?: (imageDataUrl: string) => void;
};

export default function ImagePreview({ file, pageNumber, questionNumber, onImageLoaded }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!file || !pageNumber || !questionNumber) return;
      setLoading(true);
      setError("");
      setSrc(null);
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("pageNumber", String(pageNumber));
        fd.append("questionNumber", String(questionNumber));
        const response = await fetch("/api/pdf/images", { method: "POST", body: fd });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || data.error || "圖片擷取失敗");
        if (!cancelled) {
          if (data.imageDataUrl) {
            setSrc(data.imageDataUrl);
            onImageLoaded?.(data.imageDataUrl);
          } else {
            setError("找到了圖片位置，但目前無法擷取圖片內容。");
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "圖片擷取失敗");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [file, pageNumber, questionNumber, onImageLoaded]);

  if (loading) return <div className="mt-4 rounded-2xl border border-dashed border-amber-200 bg-amber-50/60 p-5 text-sm text-amber-700">🖼 正在載入圖片預覽…</div>;
  if (error) return <div className="mt-4 rounded-2xl border border-dashed border-amber-200 bg-amber-50/60 p-5 text-sm text-amber-700">🖼 {error}</div>;
  if (!src) return null;

  return (
    <div className="mt-4 w-full">
      <img
        src={src}
        alt={`第 ${questionNumber} 題 PDF 圖片`}
        className="mx-auto block h-auto w-auto max-w-full rounded-xl object-contain"
      />
    </div>
  );
}
