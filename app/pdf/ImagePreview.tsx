"use client";

import { memo, useEffect, useRef, useState } from "react";

import type { PdfRegion } from "@/lib/pdf-layout";
type Props = {
  regions?: PdfRegion[];
  file: File | null;
  pageNumber?: number;
  questionNumber: number;
  onImageLoaded?: (imageDataUrl: string, imageDataUrls: string[]) => void;
};

type ImageResponse = {
  imageDataUrl?: string | null;
  imageDataUrls?: string[];
  extractionMode?: string;
  error?: string;
  detail?: string;
};

const MAX_PARALLEL_IMAGE_REQUESTS = 2;
const IMAGE_REQUEST_TIMEOUT_MS = 60_000;
const fileIds = new WeakMap<File, number>();
let nextFileId = 0;
const imageRequestCache = new Map<string, Promise<ImageResponse>>();
const imageDataCache = new Map<string, ImageResponse>();
const imageRequestQueue: Array<{
  key: string;
  request: () => Promise<ImageResponse>;
  resolve: (value: ImageResponse) => void;
  reject: (reason: unknown) => void;
}> = [];
let activeImageRequests = 0;

function pumpImageRequests() {
  while (activeImageRequests < MAX_PARALLEL_IMAGE_REQUESTS && imageRequestQueue.length) {
    const job = imageRequestQueue.shift();
    if (!job) break;
    activeImageRequests += 1;
    job.request()
      .then((value) => job.resolve(value))
      .catch((error) => job.reject(error))
      .finally(() => {
        activeImageRequests -= 1;
        pumpImageRequests();
      });
  }
}

function requestImagePreview(file: File, pageNumber: number, questionNumber: number, key: string, regions?: PdfRegion[]): Promise<ImageResponse> {
  const cached = imageDataCache.get(key);
  if (cached) return Promise.resolve(cached);
  const existing = imageRequestCache.get(key);
  if (existing) return existing;

  const promise = new Promise<ImageResponse>((resolve, reject) => {
    imageRequestQueue.push({
      key,
      resolve,
      reject,
      request: async () => {
        const fd = new FormData();
        fd.append("file", file);
        if (regions) fd.append("regions", JSON.stringify(regions));
        fd.append("pageNumber", String(pageNumber));
        fd.append("questionNumber", String(questionNumber));
        const response = await fetch("/api/pdf/images-v10", { method: "POST", body: fd, signal: AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS) });
        const data = (await response.json()) as ImageResponse;
        if (!response.ok) throw new Error(data.detail || data.error || "圖片擷取失敗");
        imageDataCache.set(key, data);
        if (imageDataCache.size > 80) {
          const oldest = imageDataCache.keys().next().value;
          if (oldest) imageDataCache.delete(oldest);
        }
        return data;
      },
    });
    pumpImageRequests();
  });

  imageRequestCache.set(key, promise);
  void promise.finally(() => imageRequestCache.delete(key)).catch(() => {});
  return promise;
}

function ImagePreview({ file, pageNumber, questionNumber, onImageLoaded, regions }: Props) {
  const [srcs, setSrcs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [extractionMode, setExtractionMode] = useState("");
  const [shouldLoad, setShouldLoad] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const callbackRef = useRef(onImageLoaded);
  useEffect(() => { callbackRef.current = onImageLoaded; }, [onImageLoaded]);
  const regionKey = JSON.stringify(regions);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") { queueMicrotask(() => setShouldLoad(true)); return; }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: "250px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const currentFile = file;
    if (!shouldLoad || !currentFile || !pageNumber || !questionNumber) return;
    if (!fileIds.has(currentFile)) fileIds.set(currentFile, ++nextFileId);
    const loadKey = `${fileIds.get(currentFile)}:${pageNumber}:${questionNumber}:${regionKey}`;

    let cancelled = false;

    async function load(pdfFile: File, pdfPageNumber: number, pdfQuestionNumber: number) {
      setLoading(true);
      setError("");
      setExtractionMode("");
      try {
        const data = await requestImagePreview(pdfFile, pdfPageNumber, pdfQuestionNumber, loadKey, regions);
        if (cancelled) return;
        setExtractionMode(typeof data.extractionMode === "string" ? data.extractionMode : "unknown");
        const nextSrcs = Array.isArray(data.imageDataUrls) && data.imageDataUrls.length
          ? data.imageDataUrls
          : data.imageDataUrl
            ? [data.imageDataUrl]
            : [];
        if (nextSrcs.length) {
          setSrcs(nextSrcs);
          callbackRef.current?.(nextSrcs[0], nextSrcs);
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
  }, [file, pageNumber, questionNumber, regionKey, regions, shouldLoad, retry]);

  return (
    <div ref={containerRef} className="mt-4 w-full min-h-24 rounded-xl">
      {error && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">圖片載入失敗：{error}<button type="button" className="ml-2 underline" onClick={()=>{imageDataCache.clear();imageRequestCache.clear();setRetry(n=>n+1)}}>重試圖片</button></div>}
      {loading && !srcs.length && <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">正在載入圖片預覽…</div>}
      {!shouldLoad && !error && <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-400">圖片即將載入…</div>}
      {srcs.length > 0 && (
        <>
          <div className="mb-2 text-xs text-slate-400">圖片擷取方式：{extractionMode || "未知"} · 共 {srcs.length} 張</div>
          <div className="space-y-4">
            {srcs.map((src, index) => (
              <img key={`${questionNumber}-${index}-${src.slice(-24)}`} src={src} alt={`第 ${questionNumber} 題 PDF 圖片 ${index + 1}`} decoding="async" fetchPriority={index === 0 ? "high" : "auto"} className="mx-auto block h-auto max-w-full rounded-xl object-contain" />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default memo(ImagePreview);
