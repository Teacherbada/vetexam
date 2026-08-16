import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImageAsset = { x: number; y: number; width: number; height: number; isMask: boolean };
type TextItem = { text: string; y: number; height: number };
type Anchor = { number: number; topY: number };
type PageIndex = { page: any; pageNumber: number; viewport: any; anchors: Anchor[]; images: ImageAsset[] };
type ImageContext = { page: any; pageNumber: number; viewport: any; images: ImageAsset[] };
type PdfCacheEntry = { pdf: any; createdAt: number; hits: number };
type CanvasCacheEntry = { canvas: any; createdAt: number };
type ImageDebugPage = { page: number; anchorCount: number; hasTargetAnchor: boolean; imageAssetCount: number; selectedImageCount: number; targetTopY?: number; upperBound?: number };

const RENDER_PADDING = 12;
const RENDER_SCALE = 1.5;
const MIN_REAL_IMAGE_WIDTH = 40;
const MIN_REAL_IMAGE_HEIGHT = 40;
const MAX_LOOKAHEAD_PAGES = 3;
const PDF_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHED_PDFS = 2;
const MAX_CACHED_PAGE_INDEXES = 12;
const MAX_CACHED_RENDERED_PAGES = 6;
const MAX_TILE_VERTICAL_GAP = 24;
const MIN_TILE_HORIZONTAL_OVERLAP_RATIO = 0.85;
const MIN_TILE_WIDTH_RATIO = 0.85;

const pdfCache = new Map<string, PdfCacheEntry>();
const pageIndexCache = new Map<string, PageIndex>();
const renderedPageCache = new Map<string, CanvasCacheEntry>();
const imageCache = new Map<string, { dataUrls: string[]; createdAt: number }>();

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user?.id) return NextResponse.json({ error: "請先登入。" }, { status: 401 });
    const formData = await request.formData();
    const file = formData.get("file");
    const pageNumber = Number(formData.get("pageNumber"));
    const questionNumber = Number(formData.get("questionNumber"));
    if (!(file instanceof File) || file.type !== "application/pdf") return NextResponse.json({ error: "沒有收到有效的 PDF。" }, { status: 400 });
    if (!Number.isInteger(pageNumber) || pageNumber < 1) return NextResponse.json({ error: "無效的 PDF 頁碼。" }, { status: 400 });
    if (!Number.isInteger(questionNumber) || questionNumber < 1) return NextResponse.json({ error: "無效的題號。" }, { status: 400 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdfHash = createHash("sha256").update(bytes).digest("hex");
    const cacheKey = `${pdfHash}:${pageNumber}:${questionNumber}`;
    const cachedImages = getCachedImage(cacheKey);
    if (cachedImages !== undefined) return NextResponse.json({ success: true, pageNumber, questionNumber, imageDataUrl: cachedImages[0] ?? null, imageDataUrls: cachedImages, imageCount: cachedImages.length, extractionMode: "pdf-region-render-v10", debug: { stage: "image-cache-hit" } });

    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await getCachedPdf(pdfjsLib, pdfHash, bytes);
    if (pageNumber > pdf.numPages) return NextResponse.json({ error: "PDF 頁碼超出範圍。" }, { status: 400 });
    const result = await findImageContexts(pdf, pdfHash, pageNumber, questionNumber);
    const contexts = result.contexts;
    if (!contexts.length) {
      console.warn("PDF image pipeline: no image context", { pageNumber, questionNumber, debug: result.debug });
      return NextResponse.json({ success: true, pageNumber, questionNumber, imageDataUrl: null, imageDataUrls: [], imageCount: 0, extractionMode: "pdf-region-render-v10", debug: result.debug });
    }

    try {
      const renderedDataUrls = await renderImageContexts(contexts, pdfHash);
      if (!renderedDataUrls.length) throw new Error("沒有產生有效圖片。");
      setCachedImage(cacheKey, renderedDataUrls);
      return NextResponse.json({ success: true, imagePageNumber: contexts[0].pageNumber, pageNumber, questionNumber, imageDataUrl: renderedDataUrls[0] ?? null, imageDataUrls: renderedDataUrls, imageCount: renderedDataUrls.length, imagePageNumbers: contexts.map((context) => context.pageNumber), extractionMode: "pdf-region-render-v10", debug: { ...result.debug, stage: "render-complete", groupedImageCount: renderedDataUrls.length } });
    } catch (renderError) {
      console.error("PDF region rendering failed:", renderError);
      return NextResponse.json({ error: "PDF 圖片 Render 失敗", detail: renderError instanceof Error ? renderError.message : String(renderError), pageNumber, questionNumber, imagePageNumbers: contexts.map((context) => context.pageNumber), debug: { ...result.debug, stage: "render-failed", contextCount: contexts.length, contextImageCounts: contexts.map((context) => context.images.length) } }, { status: 500 });
    }
  } catch (error) {
    console.error("PDF image extraction error:", error);
    return NextResponse.json({ error: "圖片擷取失敗", detail: error instanceof Error ? error.message : "未知錯誤" }, { status: 500 });
  }
}

function getCachedImage(key: string): string[] | undefined {
  const entry = imageCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > PDF_CACHE_TTL_MS) { imageCache.delete(key); return undefined; }
  return entry.dataUrls;
}

function setCachedImage(key: string, dataUrls: string[]) {
  imageCache.set(key, { dataUrls, createdAt: Date.now() });
  while (imageCache.size > 80) {
    const oldest = imageCache.keys().next().value;
    if (!oldest) break;
    imageCache.delete(oldest);
  }
}

async function getCachedPdf(pdfjsLib: any, hash: string, bytes: Uint8Array): Promise<any> {
  const existing = pdfCache.get(hash);
  if (existing && Date.now() - existing.createdAt <= PDF_CACHE_TTL_MS) { existing.hits += 1; pdfCache.delete(hash); pdfCache.set(hash, existing); return existing.pdf; }
  if (existing) pdfCache.delete(hash);
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  pdfCache.set(hash, { pdf, createdAt: Date.now(), hits: 0 });
  while (pdfCache.size > MAX_CACHED_PDFS) {
    const oldest = pdfCache.keys().next().value;
    if (!oldest) break;
    const oldEntry = pdfCache.get(oldest);
    try { await oldEntry?.pdf?.destroy?.(); } catch {}
    pdfCache.delete(oldest);
  }
  return pdf;
}

async function getPageIndex(pdf: any, pdfHash: string, pageNumber: number): Promise<PageIndex> {
  const key = `${pdfHash}:${pageNumber}`;
  const cached = pageIndexCache.get(key);
  if (cached) return cached;
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();
  const items: TextItem[] = textContent.items.filter((item: any) => typeof item.str === "string" && item.str.trim()).map((item: any) => ({ text: item.str.trim(), y: Number(item.transform?.[5] ?? 0), height: Number(item.height ?? 0) }));
  const anchors = getQuestionAnchors(items, viewport.height).sort((a, b) => a.topY - b.topY);
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const operatorList = await page.getOperatorList();
  const images = await getImageAssets(pdfjsLib, page, operatorList, viewport);
  const result = { page, pageNumber, viewport, anchors, images };
  pageIndexCache.set(key, result);
  while (pageIndexCache.size > MAX_CACHED_PAGE_INDEXES) { const oldest = pageIndexCache.keys().next().value; if (!oldest) break; pageIndexCache.delete(oldest); }
  return result;
}

async function findImageContexts(pdf: any, pdfHash: string, questionPageNumber: number, questionNumber: number): Promise<{ contexts: ImageContext[]; debug: { stage: string; pages: ImageDebugPage[]; foundTargetAnchor: boolean; contextCount: number } }> {
  const contexts: ImageContext[] = [];
  const pages: ImageDebugPage[] = [];
  let foundTarget = false;
  let continuationAllowed = false;
  for (let pageNo = questionPageNumber; pageNo <= Math.min(pdf.numPages, questionPageNumber + MAX_LOOKAHEAD_PAGES); pageNo++) {
    const index = await getPageIndex(pdf, pdfHash, pageNo);
    const targetIndex = index.anchors.findIndex((anchor) => anchor.number === questionNumber);
    const debugPage: ImageDebugPage = { page: pageNo, anchorCount: index.anchors.length, hasTargetAnchor: targetIndex >= 0, imageAssetCount: index.images.length, selectedImageCount: 0 };
    if (targetIndex >= 0) {
      foundTarget = true;
      const target = index.anchors[targetIndex];
      const nextSamePage = index.anchors.slice(targetIndex + 1).find((anchor) => anchor.number > questionNumber);
      const upper = nextSamePage ? nextSamePage.topY : Number.POSITIVE_INFINITY;
      debugPage.targetTopY = target.topY;
      debugPage.upperBound = upper;
      const selected = selectImagesInRegion(index.images, target.topY, upper);
      debugPage.selectedImageCount = selected.length;
      pages.push(debugPage);
      if (selected.length) { contexts.push({ page: index.page, pageNumber: pageNo, viewport: index.viewport, images: selected }); break; }
      continuationAllowed = !nextSamePage;
      if (!continuationAllowed) break;
      continue;
    }
    if (!foundTarget) { pages.push(debugPage); continue; }
    if (index.anchors.length > 0) {
      const firstQuestion = index.anchors.find((anchor) => anchor.number > questionNumber);
      if (!continuationAllowed) { pages.push(debugPage); break; }
      const upper = firstQuestion ? firstQuestion.topY : Number.POSITIVE_INFINITY;
      const selected = selectImagesInRegion(index.images, 0, upper);
      debugPage.upperBound = upper;
      debugPage.selectedImageCount = selected.length;
      pages.push(debugPage);
      if (selected.length) contexts.push({ page: index.page, pageNumber: pageNo, viewport: index.viewport, images: selected });
      break;
    }
    if (continuationAllowed) {
      const selected = selectImagesInRegion(index.images, 0, Number.POSITIVE_INFINITY);
      debugPage.selectedImageCount = selected.length;
      pages.push(debugPage);
      if (selected.length) { contexts.push({ page: index.page, pageNumber: pageNo, viewport: index.viewport, images: selected }); break; }
    } else pages.push(debugPage);
  }
  return { contexts, debug: { stage: contexts.length ? "context-found" : foundTarget ? "target-found-but-no-image-selected" : "target-anchor-not-found", pages, foundTargetAnchor: foundTarget, contextCount: contexts.length } };
}

function selectImagesInRegion(images: ImageAsset[], top: number, bottom: number): ImageAsset[] {
  if (!images.length) return [];
  return images.filter((image) => {
    const imageTop = image.y;
    const imageBottom = image.y + image.height;
    const center = image.y + image.height / 2;
    return center >= top && center <= bottom && imageBottom > top && imageTop < bottom;
  }).sort((a, b) => a.y - b.y || a.x - b.x);
}

function groupImageAssets(images: ImageAsset[]): ImageAsset[][] {
  const sorted = [...images].sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: ImageAsset[][] = [];
  for (const image of sorted) {
    let bestGroup: ImageAsset[] | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const group of groups) {
      const last = group[group.length - 1];
      const gap = image.y - (last.y + last.height);
      if (gap < 0) continue;
      const minWidth = Math.min(image.width, last.width);
      const minHeight = Math.min(image.height, last.height);
      const maxWidth = Math.max(image.width, last.width);
      const maxHeight = Math.max(image.height, last.height);
      const overlapLeft = Math.max(image.x, last.x);
      const overlapRight = Math.min(image.x + image.width, last.x + last.width);
      const overlapWidth = Math.max(0, overlapRight - overlapLeft);
      const overlapRatio = overlapWidth / Math.max(1, minWidth);
      const widthRatio = minWidth / Math.max(1, maxWidth);
      const heightRatio = minHeight / Math.max(1, maxHeight);
      const centerDelta = Math.abs((image.x + image.width / 2) - (last.x + last.width / 2));
      const centerAlignment = centerDelta / Math.max(1, minWidth);
      const maxGap = Math.max(MAX_TILE_VERTICAL_GAP, minHeight * 0.25);
      if (gap > maxGap || overlapRatio < 0.70 || widthRatio < 0.65 || heightRatio < 0.45 || centerAlignment > 0.18) continue;
      const score = overlapRatio * 4 + widthRatio * 3 + heightRatio * 1.5 + Math.max(0, 1 - centerAlignment) * 2 - gap / Math.max(1, maxGap);
      if (score > bestScore) { bestGroup = group; bestScore = score; }
    }
    if (bestGroup) bestGroup.push(image); else groups.push([image]);
  }
  return groups;
}

async function renderImageContexts(contexts: ImageContext[], pdfHash: string): Promise<string[]> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
  const canvasModule = await dynamicImport("@napi-rs/canvas");
  if (canvasModule?.DOMMatrix && typeof globalThis.DOMMatrix === "undefined") (globalThis as any).DOMMatrix = canvasModule.DOMMatrix;
  if (canvasModule?.ImageData && typeof globalThis.ImageData === "undefined") (globalThis as any).ImageData = canvasModule.ImageData;
  if (canvasModule?.Path2D && typeof globalThis.Path2D === "undefined") (globalThis as any).Path2D = canvasModule.Path2D;
  const rendered: string[] = [];
  for (const context of contexts) {
    const pageCanvas = await getRenderedPageCanvas(context, pdfHash, canvasModule);
    const groups = groupImageAssets(context.images);
    for (const group of groups) {
      const left = Math.max(0, Math.min(...group.map((image) => image.x)) - RENDER_PADDING);
      const top = Math.max(0, Math.min(...group.map((image) => image.y)) - RENDER_PADDING);
      const right = Math.min(context.viewport.width, Math.max(...group.map((image) => image.x + image.width)) + RENDER_PADDING);
      const bottom = Math.min(context.viewport.height, Math.max(...group.map((image) => image.y + image.height)) + RENDER_PADDING);
      const cropLeft = Math.max(0, Math.floor(left * RENDER_SCALE));
      const cropTop = Math.max(0, Math.floor(top * RENDER_SCALE));
      const cropRight = Math.min(pageCanvas.width, Math.ceil(right * RENDER_SCALE));
      const cropBottom = Math.min(pageCanvas.height, Math.ceil(bottom * RENDER_SCALE));
      const cropWidth = cropRight - cropLeft;
      const cropHeight = cropBottom - cropTop;
      if (cropWidth <= 0 || cropHeight <= 0) continue;
      const cropCanvas = canvasModule.createCanvas(cropWidth, cropHeight);
      cropCanvas.getContext("2d").drawImage(pageCanvas, cropLeft, cropTop, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      rendered.push(cropCanvas.toDataURL("image/png"));
    }
  }
  return rendered;
}

async function getRenderedPageCanvas(context: ImageContext, pdfHash: string, canvasModule: any): Promise<any> {
  const key = `${pdfHash}:${context.pageNumber}`;
  const cached = renderedPageCache.get(key);
  if (cached && Date.now() - cached.createdAt <= PDF_CACHE_TTL_MS) { renderedPageCache.delete(key); renderedPageCache.set(key, cached); return cached.canvas; }
  const viewport = context.page.getViewport({ scale: RENDER_SCALE });
  const pageCanvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const pageContext = pageCanvas.getContext("2d");
  await context.page.render({ canvasContext: pageContext, viewport }).promise;
  renderedPageCache.set(key, { canvas: pageCanvas, createdAt: Date.now() });
  while (renderedPageCache.size > MAX_CACHED_RENDERED_PAGES) { const oldest = renderedPageCache.keys().next().value; if (!oldest) break; renderedPageCache.delete(oldest); }
  return pageCanvas;
}

async function getImageAssets(pdfjsLib: any, page: any, operatorList: any, viewport: any): Promise<ImageAsset[]> {
  const imageOps = new Set<number>([pdfjsLib.OPS.paintImageXObject, pdfjsLib.OPS.paintInlineImageXObject, pdfjsLib.OPS.paintJpegXObject, pdfjsLib.OPS.paintImageXObjectRepeat].filter((value): value is number => typeof value === "number"));
  const assets: ImageAsset[] = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const addImageRegion = (localTransform: number[], imageWidth = 1, imageHeight = 1) => {
    const transform = pdfjsLib.Util.transform(viewport.transform, pdfjsLib.Util.transform(ctm, localTransform));
    const points = [[0, 0], [imageWidth, 0], [0, imageHeight], [imageWidth, imageHeight]].map((point) => pdfjsLib.Util.applyTransform(point, transform));
    const xs = points.map((point: number[]) => point[0]);
    const ys = points.map((point: number[]) => point[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const width = Math.max(...xs) - x;
    const height = Math.max(...ys) - y;
    if (width < MIN_REAL_IMAGE_WIDTH || height < MIN_REAL_IMAGE_HEIGHT) return;
    assets.push({ x, y, width, height, isMask: false });
  };
  for (let i = 0; i < operatorList.fnArray.length; i++) {
    const fn = operatorList.fnArray[i];
    const args = operatorList.argsArray[i] ?? [];
    if (fn === pdfjsLib.OPS.save) { stack.push([...ctm]); continue; }
    if (fn === pdfjsLib.OPS.restore) { ctm = stack.pop() ?? ctm; continue; }
    if (fn === pdfjsLib.OPS.paintFormXObjectBegin) { stack.push([...ctm]); if (Array.isArray(args[0]) && args[0].length === 6) ctm = pdfjsLib.Util.transform(ctm, args[0]); continue; }
    if (fn === pdfjsLib.OPS.paintFormXObjectEnd) { ctm = stack.pop() ?? ctm; continue; }
    if (fn === pdfjsLib.OPS.transform && args.length >= 6) { ctm = pdfjsLib.Util.transform(ctm, args.slice(0, 6)); continue; }
    if (!imageOps.has(fn)) continue;
    if (fn === pdfjsLib.OPS.paintImageXObjectRepeat) {
      const scaleX = Number(args[1] || 1);
      const scaleY = Number(args[2] || 1);
      const positions = Array.isArray(args[3]) ? args[3] : [];
      for (let p = 0; p + 1 < positions.length; p += 2) addImageRegion([scaleX, 0, 0, scaleY, Number(positions[p]), Number(positions[p + 1])]);
      continue;
    }
    const imageId = typeof args[0] === "string" ? args[0] : null;
    if ((fn === pdfjsLib.OPS.paintJpegXObject || fn === pdfjsLib.OPS.paintImageXObject) && imageId && args.length < 3) {
      try { await getPdfObject(page.objs, imageId) || await getPdfObject(page.commonObjs, imageId); } catch {}
    }
    addImageRegion([1, 0, 0, 1, 0, 0], 1, 1);
  }
  const unique: ImageAsset[] = [];
  for (const asset of assets) {
    const duplicate = unique.some((existing) => Math.abs(existing.x - asset.x) < 1 && Math.abs(existing.y - asset.y) < 1 && Math.abs(existing.width - asset.width) < 1 && Math.abs(existing.height - asset.height) < 1);
    if (!duplicate) unique.push(asset);
  }
  return unique;
}

function getPdfObject(objects: any, id: string): Promise<any | null> {
  if (!objects || typeof objects.has !== "function" || !objects.has(id)) return Promise.resolve(null);
  return new Promise((resolve) => { try { resolve(objects.get(id) ?? null); } catch { try { objects.get(id, (value: any) => resolve(value ?? null)); } catch { resolve(null); } } });
}

function getQuestionAnchors(items: TextItem[], pageHeight: number): Anchor[] {
  const anchors: Anchor[] = [];
  const regex = /^\s*(?:[（(]\s*)?(\d{1,3})(?:\s*[）)])?\s*(?:[.、．:：]|(?=\S))/;
  for (const item of items) {
    const match = item.text.match(regex);
    if (!match) continue;
    const number = Number(match[1]);
    if (number >= 1 && number <= 999) anchors.push({ number, topY: pageHeight - item.y });
  }
  return anchors;
}
