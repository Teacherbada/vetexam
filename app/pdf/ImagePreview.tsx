"use client";

import { memo, useEffect, useRef, useState } from "react";

type Props = {
  file: File | null;
  pageNumber?: number;
  questionNumber: number;
  onImageLoaded?: (imageDataUrl: string) => void;
};

function ImagePreview({ file, pageNumber, questionNumber, onImageLoaded }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [extractionMode, setExtractionMode] = useState("");
  const [shouldLoad, setShouldLoad] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const loadedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    if (typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: "500px 0px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const currentFile = file;
    if (!shouldLoad || !currentFile || !pageNumber || !questionNumber) return;

    const loadKey = `${currentFile.name}:${currentFile.size}:${currentFile.lastModified}:${pageNumber}:${questionNumber}`;
    if (loadedKeyRef.current === loadKey) return;
    loadedKeyRef.current = loadKey;

    let cancelled = false;

    async function load(pdfFile: File, pdfPageNumber: number, pdfQuestionNumber: number) {
      setLoading(true);
      setError("");
      setExtractionMode("");
      try {
        const fd = new FormData();
        fd.append("file", pdfFile);
        fd.append("pageNumber", String(pdfPageNumber));
        fd.append("questionNumber", String(pdfQuestionNumber));
        const response = await fetch("/api/pdf/images", { method: "POST", body: fd });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || data.error || "圖片擷取失敗");
        if (cancelled) return;

        setExtractionMode(typeof data.extractionMode === "string" ? data.extractionMode : "unknown");

        if (data.imageDataUrl) {
          setSrc(data.imageDataUrl);
          onImageLoaded?.(data.imageDataUrl);
        } else {
          setError("目前找不到這題可用的圖片內容。");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "圖片擷取失敗");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load(currentFile, pageNumber, questionNumber);
    return () => { cancelled = true; };
  }, [file, pageNumber, questionNumber, onImageLoaded, shouldLoad]);

  return (
    <div ref={containerRef} className="mt-4 w-full min-h-24 rounded-xl">
      {error && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">圖片載入失敗：{error}</div>}
      {loading && !src && <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">正在載入圖片預覽…</div>}
      {!shouldLoad && !error && <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-400">圖片即將載入…</div>}
      {src && (
        <>
          <div className="mb-2 text-xs text-slate-400">
            圖片擷取方式：{extractionMode || "未知"}
          </div>
          <img
            src={src}
            alt={`第 ${questionNumber} 題 PDF 圖片`}
            loading="lazy"
            className="mx-auto block h-auto max-w-full rounded-xl object-contain"
          />
        </>
      )}
    </div>
  );
}

export default memo(ImagePreview);
