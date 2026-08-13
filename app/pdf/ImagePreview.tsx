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
  const loadedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const currentFile = file;
    if (!currentFile || !pageNumber || !questionNumber) return;

    const loadKey = `${currentFile.name}:${currentFile.size}:${currentFile.lastModified}:${pageNumber}:${questionNumber}`;
    if (loadedKeyRef.current === loadKey) return;
    loadedKeyRef.current = loadKey;

    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const fd = new FormData();
        fd.append("file", currentFile);
        fd.append("pageNumber", String(pageNumber));
        fd.append("questionNumber", String(questionNumber));
        const response = await fetch("/api/pdf/images", { method: "POST", body: fd });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || data.error || "圖片擷取失敗");
        if (cancelled) return;

        if (data.imageDataUrl) {
          setSrc(data.imageDataUrl);
          onImageLoaded?.(data.imageDataUrl);
        } else {
          setError("找到了圖片位置，但目前無法擷取圖片內容。");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "圖片擷取失敗");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [currentFile, pageNumber, questionNumber, onImageLoaded]);

  if (error) return <div className="mt-4 text-sm text-amber-700">🖼 {error}</div>;
  if (loading && !src) return <div className="mt-4 text-sm text-amber-700">🖼 正在載入圖片預覽…</div>;
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

export default memo(ImagePreview);
