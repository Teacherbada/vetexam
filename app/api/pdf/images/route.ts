import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImageAsset = { x: number; y: number; width: number; height: number; isMask: boolean };
type TextItem = { text: string; y: number; height: number };
type Anchor = { number: number; topY: number };
type ImageContext = { page: any; pageNumber: number; viewport: any; images: ImageAsset[] };
type PdfCacheEntry = { pdf: any; createdAt: number; hits: number };

const RENDER_PADDING = 12;
const RENDER_SCALE = 1.5;
const MIN_MASK_WIDTH = 28;
const MIN_MASK_HEIGHT = 28;
const MIN_MASK_AREA = 900;
const MAX_LOOKAHEAD_PAGES = 3;
const PDF_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHED_PDFS = 2;

// Vercel may reuse a warm Node.js instance. Keeping a very small in-memory cache
// avoids reopening and reparsing the same PDF for every lazy-loaded question image.
const pdfCache = new Map<string, PdfCacheEntry>();
const imageCache = new Map<string, { dataUrl: string | null; createdAt: number }>();

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
    const cachedImage = getCachedImage(cacheKey);
    if (cachedImage !== undefined) {
      return NextResponse.json({
        success: true,
        pageNumber,
        questionNumber,
        imageDataUrl: cachedImage,
        imageCount: cachedImage ? 1 : 0,
        extractionMode: "pdf-region-render-v4-cache",
      });
    }

    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await getCachedPdf(pdfjsLib, pdfHash, bytes);
    if (pageNumber > pdf.numPages) return NextResponse.json({ error: "PDF 頁碼超出範圍。" }, { status: 400 });

    const contexts = await findImageContexts(pdfjsLib, pdf, pageNumber, questionNumber);
    if (!contexts.length) {
      setCachedImage(cacheKey, null);
      return NextResponse.json({
        success: true,
        pageNumber,
        questionNumber,
        imageDataUrl: null,
        imageCount: 0,
        extractionMode: "pdf-region-render-v4-cache",
      });
    }

    try {
      const renderedDataUrl = await renderImageContexts(pdfjsLib, contexts);
      if (!renderedDataUrl) throw new Error("沒有產生有效圖片。");
      setCachedImage(cacheKey, renderedDataUrl);
      return NextResponse.json({
        success: true,
        pageNumber,
        imagePageNumber: contexts[0].pageNumber,
        questionNumber,
        imageDataUrl: renderedDataUrl,
        imageCount: contexts.reduce((sum, context) => sum + context.images.length, 0),
        imagePageNumbers: contexts.map((context) => context.pageNumber),
        extractionMode: "pdf-region-render-v4-cache",
      });
    } catch (renderError) {
      console.error("PDF region rendering failed:", renderError);
      return NextResponse.json({
        error: "PDF 圖片 Render 失敗",
        detail: renderError instanceof Error ? renderError.message : String(renderError),
        pageNumber,
        questionNumber,
        imagePageNumbers: contexts.map((context) => context.pageNumber),
      }, { status: 500 });
    }
  } catch (error) {
    console.error("PDF image extraction error:", error);
    return NextResponse.json({ error: "圖片擷取失敗", detail: error instanceof Error ? error.message : "未知錯誤" }, { status: 500 });
  }
}

function getCachedImage(key: string): string | null | undefined {
  const entry = imageCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > PDF_CACHE_TTL_MS) {
    imageCache.delete(key);
    return undefined;
  }
  return entry.dataUrl;
}

function setCachedImage(key: string, dataUrl: string | null) {
  imageCache.set(key, { dataUrl, createdAt: Date.now() });
  while (imageCache.size > 80) {
    const oldest = imageCache.keys().next().value;
    if (!oldest) break;
    imageCache.delete(oldest);
  }
}

async function getCachedPdf(pdfjsLib: any, hash: string, bytes: Uint8Array): Promise<any> {
  const existing = pdfCache.get(hash);
  if (existing && Date.now() - existing.createdAt <= PDF_CACHE_TTL_MS) {
    existing.hits += 1;
    pdfCache.delete(hash);
    pdfCache.set(hash, existing);
    return existing.pdf;
  }

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

async function findImageContexts(pdfjsLib: any, pdf: any, questionPageNumber: number, questionNumber: number): Promise<ImageContext[]> {
  const contexts: ImageContext[] = [];
  let targetFound = false;

  for (let pageNo = questionPageNumber; pageNo <= Math.min(pdf.numPages, questionPageNumber + MAX_LOOKAHEAD_PAGES); pageNo++) {
    const page = await pdf.getPage(pageNo);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const items: TextItem[] = textContent.items
      .filter((item: any) => typeof item.str === "string" && item.str.trim())
      .map((item: any) => ({ text: item.str.trim(), y: Number(item.transform?.[5] ?? 0), height: Number(item.height ?? 0) }));
    const anchors = getQuestionAnchors(items, viewport.height);
    const orderedAnchors = [...anchors].sort((a, b) => a.topY - b.topY);
    const targetIndex = orderedAnchors.findIndex((anchor) => anchor.number === questionNumber);
    const target = targetIndex >= 0 ? orderedAnchors[targetIndex] : undefined;
    const next = targetIndex >= 0
      ? orderedAnchors.slice(targetIndex + 1).find((anchor) => anchor.number !== questionNumber)
      : orderedAnchors.find((anchor) => anchor.number !== questionNumber);

    const operatorList = await page.getOperatorList();
    const images = await getImageAssets(pdfjsLib, page, operatorList, viewport);
    if (!images.length) {
      if (targetFound) break;
      continue;
    }

    let selected: ImageAsset[] = [];
    if (target) {
      targetFound = true;
      const lower = target.topY - 12;
      const upper = next ? next.topY - 12 : Number.POSITIVE_INFINITY;
      selected = images.filter((image) => image.y >= lower && image.y <= upper);
    } else if (pageNo > questionPageNumber && targetFound) {
      const boundary = next ? next.topY - 12 : Number.POSITIVE_INFINITY;
      selected = images.filter((image) => image.y <= boundary);
    }

    if (selected.length) contexts.push({ page, pageNumber: pageNo, viewport, images: selected });
    if (targetFound && next && next.number !== questionNumber) break;
  }

  return contexts;
}

async function renderImageContexts(pdfjsLib: any, contexts: ImageContext[]): Promise<string | null> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
  const canvasModule = await dynamicImport("@napi-rs/canvas");
  if (canvasModule?.DOMMatrix && typeof globalThis.DOMMatrix === "undefined") (globalThis as any).DOMMatrix = canvasModule.DOMMatrix;
  if (canvasModule?.ImageData && typeof globalThis.ImageData === "undefined") (globalThis as any).ImageData = canvasModule.ImageData;
  if (canvasModule?.Path2D && typeof globalThis.Path2D === "undefined") (globalThis as any).Path2D = canvasModule.Path2D;

  const rendered: any[] = [];
  for (const context of contexts) {
    const viewport = context.page.getViewport({ scale: RENDER_SCALE });
    const pageCanvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const pageContext = pageCanvas.getContext("2d");
    await context.page.render({ canvasContext: pageContext, viewport }).promise;

    const left = Math.max(0, Math.min(...context.images.map((image) => image.x)) - RENDER_PADDING);
    const top = Math.max(0, Math.min(...context.images.map((image) => image.y - image.height / 2)) - RENDER_PADDING);
    const right = Math.min(context.viewport.width, Math.max(...context.images.map((image) => image.x + image.width)) + RENDER_PADDING);
    const bottom = Math.min(context.viewport.height, Math.max(...context.images.map((image) => image.y + image.height / 2)) + RENDER_PADDING);

    const cropLeft = Math.max(0, Math.floor(left * RENDER_SCALE));
    const cropTop = Math.max(0, Math.floor(top * RENDER_SCALE));
    const cropRight = Math.min(pageCanvas.width, Math.ceil(right * RENDER_SCALE));
    const cropBottom = Math.min(pageCanvas.height, Math.ceil(bottom * RENDER_SCALE));
    const cropWidth = cropRight - cropLeft;
    const cropHeight = cropBottom - cropTop;
    if (cropWidth <= 0 || cropHeight <= 0) continue;

    const cropCanvas = canvasModule.createCanvas(cropWidth, cropHeight);
    cropCanvas.getContext("2d").drawImage(pageCanvas, cropLeft, cropTop, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    rendered.push(cropCanvas);
  }

  if (!rendered.length) return null;
  if (rendered.length === 1) return rendered[0].toDataURL("image/png");

  const gap = 24;
  const width = Math.max(...rendered.map((canvas) => canvas.width));
  const height = rendered.reduce((sum, canvas) => sum + canvas.height, 0) + gap * (rendered.length - 1);
  const combined = canvasModule.createCanvas(width, height);
  const ctx = combined.getContext("2d");
  let y = 0;
  for (const canvas of rendered) {
    ctx.drawImage(canvas, 0, y);
    y += canvas.height + gap;
  }
  return combined.toDataURL("image/png");
}

async function getImageAssets(pdfjsLib: any, page: any, operatorList: any, viewport: any): Promise<ImageAsset[]> {
  const imageOps = new Set<number>([
    pdfjsLib.OPS.paintImageMaskXObject,
    pdfjsLib.OPS.paintImageXObject,
    pdfjsLib.OPS.paintInlineImageXObject,
    pdfjsLib.OPS.paintImageMaskXObjectRepeat,
    pdfjsLib.OPS.paintImageXObjectRepeat,
    pdfjsLib.OPS.paintJpegXObject,
  ].filter((value): value is number => typeof value === "number"));

  const assets: ImageAsset[] = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];

  for (let i = 0; i < operatorList.fnArray.length; i++) {
    const fn = operatorList.fnArray[i];
    const args = operatorList.argsArray[i] ?? [];
    if (fn === pdfjsLib.OPS.save) { stack.push([...ctm]); continue; }
    if (fn === pdfjsLib.OPS.restore) { ctm = stack.pop() ?? ctm; continue; }
    if (fn === pdfjsLib.OPS.transform && args.length >= 6) { ctm = pdfjsLib.Util.transform(ctm, args.slice(0, 6)); continue; }
    if (!imageOps.has(fn)) continue;

    let image: any = null;
    const imageId = typeof args[0] === "string" ? args[0] : null;
    try {
      if (imageId) {
        image = await getPdfObject(page.objs, imageId);
        if (!image) image = await getPdfObject(page.commonObjs, imageId);
      } else if (args[0]?.data && args[0]?.width && args[0]?.height) image = args[0];
    } catch { image = null; }
    if (!image) continue;

    const transform = pdfjsLib.Util.transform(viewport.transform, ctm);
    const points = [[0,0],[1,0],[0,1],[1,1]].map((point) => pdfjsLib.Util.applyTransform(point, transform));
    const xs = points.map((point: number[]) => point[0]);
    const ys = points.map((point: number[]) => point[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const width = Math.max(...xs) - x;
    const height = Math.max(...ys) - y;
    const isMask = fn === pdfjsLib.OPS.paintImageMaskXObject || fn === pdfjsLib.OPS.paintImageMaskXObjectRepeat;

    if (isMask && (width < MIN_MASK_WIDTH || height < MIN_MASK_HEIGHT || width * height < MIN_MASK_AREA)) continue;
    if (width < 6 || height < 6) continue;
    assets.push({ x, y: y + height / 2, width, height, isMask });
  }

  return assets;
}

function getPdfObject(objects: any, id: string): Promise<any | null> {
  if (!objects || typeof objects.has !== "function" || !objects.has(id)) return Promise.resolve(null);
  return new Promise((resolve) => {
    try { resolve(objects.get(id) ?? null); }
    catch { try { objects.get(id, (value: any) => resolve(value ?? null)); } catch { resolve(null); } }
  });
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
