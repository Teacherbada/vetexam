import { NextResponse } from "next/server";
import { deflateSync } from "zlib";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImageAsset = {
  y: number;
  x: number;
  width: number;
  height: number;
  dataUrl: string;
};
type Anchor = { number: number; y: number };

// 保留舊版 image-object 擷取作為 fallback。
const IMAGE_PADDING = 8;
// 新版從 PDF 頁面重新渲染時，在圖片四周多保留少量 PDF 內容，
// 用來包含貼在圖片邊緣的文字層數字。
const RENDER_PADDING = 14;
const RENDER_SCALE = 2;

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user?.id) return NextResponse.json({ error: "請先登入。" }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get("file");
    const pageNumber = Number(formData.get("pageNumber"));
    const questionNumber = Number(formData.get("questionNumber"));

    if (!(file instanceof File) || file.type !== "application/pdf") {
      return NextResponse.json({ error: "沒有收到有效的 PDF。" }, { status: 400 });
    }
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      return NextResponse.json({ error: "無效的 PDF 頁碼。" }, { status: 400 });
    }
    if (!Number.isInteger(questionNumber) || questionNumber < 1) {
      return NextResponse.json({ error: "無效的題號。" }, { status: 400 });
    }

    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdfBytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
    if (pageNumber > pdf.numPages) return NextResponse.json({ error: "PDF 頁碼超出範圍。" }, { status: 400 });

    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const operatorList = await page.getOperatorList();
    const images = await getImageAssets(pdfjsLib, page, operatorList, viewport);

    const textContent = await page.getTextContent();
    const items = textContent.items
      .filter((item: any) => typeof item.str === "string" && item.str.trim())
      .map((item: any) => ({ text: item.str.trim(), y: Number(item.transform?.[5] ?? 0) }));

    const anchors = getQuestionAnchors(items);
    const image = findImageNearQuestion(questionNumber, anchors, images);

    if (!image) {
      return NextResponse.json({
        success: true,
        pageNumber,
        questionNumber,
        imageDataUrl: null,
      });
    }

    // 主方案：重新渲染 PDF 的圖片區域，因此圖片旁邊屬於 PDF
    // 文字層的數字也會一起保留下來。
    try {
      const renderedDataUrl = await renderPdfRegion(pdfjsLib, page, image, viewport);
      if (renderedDataUrl) {
        return NextResponse.json({
          success: true,
          pageNumber,
          questionNumber,
          imageDataUrl: renderedDataUrl,
          extractionMode: "pdf-region-render",
        });
      }
    } catch (renderError) {
      console.warn("PDF region rendering failed; using image-object fallback:", renderError);
    }

    // fallback：保留原本已經能工作的 image-object 擷取方式。
    return NextResponse.json({
      success: true,
      pageNumber,
      questionNumber,
      imageDataUrl: image.dataUrl,
      extractionMode: "image-object-fallback",
    });
  } catch (error) {
    console.error("PDF image extraction error:", error);
    return NextResponse.json({ error: "圖片擷取失敗", detail: error instanceof Error ? error.message : "未知錯誤" }, { status: 500 });
  }
}

async function renderPdfRegion(pdfjsLib: any, page: any, image: ImageAsset, viewport: any): Promise<string | null> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
  const canvasModule = await dynamicImport("@napi-rs/canvas");

  if (canvasModule?.DOMMatrix && typeof globalThis.DOMMatrix === "undefined") {
    (globalThis as any).DOMMatrix = canvasModule.DOMMatrix;
  }
  if (canvasModule?.ImageData && typeof globalThis.ImageData === "undefined") {
    (globalThis as any).ImageData = canvasModule.ImageData;
  }
  if (canvasModule?.Path2D && typeof globalThis.Path2D === "undefined") {
    (globalThis as any).Path2D = canvasModule.Path2D;
  }

  const renderViewport = page.getViewport({ scale: RENDER_SCALE });
  const pageCanvas = canvasModule.createCanvas(
    Math.ceil(renderViewport.width),
    Math.ceil(renderViewport.height),
  );
  const pageContext = pageCanvas.getContext("2d");

  await page.render({
    canvasContext: pageContext,
    viewport: renderViewport,
  }).promise;

  const cropLeft = Math.max(0, Math.floor((image.x - RENDER_PADDING) * RENDER_SCALE));
  const cropTop = Math.max(0, Math.floor((image.y - RENDER_PADDING) * RENDER_SCALE));
  const cropRight = Math.min(
    pageCanvas.width,
    Math.ceil((image.x + image.width + RENDER_PADDING) * RENDER_SCALE),
  );
  const cropBottom = Math.min(
    pageCanvas.height,
    Math.ceil((image.y + image.height + RENDER_PADDING + 12) * RENDER_SCALE),
  );

  const cropWidth = cropRight - cropLeft;
  const cropHeight = cropBottom - cropTop;
  if (cropWidth <= 0 || cropHeight <= 0) return null;

  const cropCanvas = canvasModule.createCanvas(cropWidth, cropHeight);
  const cropContext = cropCanvas.getContext("2d");
  cropContext.drawImage(
    pageCanvas,
    cropLeft,
    cropTop,
    cropWidth,
    cropHeight,
    0,
    0,
    cropWidth,
    cropHeight,
  );

  return cropCanvas.toDataURL("image/png");
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

    const dataUrl = imageObjectToDataUrl(image);
    if (!dataUrl) continue;

    try {
      const transform = pdfjsLib.Util.transform(viewport.transform, ctm);
      const points = [
        pdfjsLib.Util.applyTransform([0, 0], transform),
        pdfjsLib.Util.applyTransform([1, 0], transform),
        pdfjsLib.Util.applyTransform([0, 1], transform),
        pdfjsLib.Util.applyTransform([1, 1], transform),
      ];
      const xs = points.map((point: number[]) => point[0]);
      const ys = points.map((point: number[]) => point[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      const width = Math.max(...xs) - x;
      const height = Math.max(...ys) - y;
      assets.push({ y: y + height / 2, x, width, height, dataUrl });
    } catch {
      assets.push({ y: 0, x: 0, width: 0, height: 0, dataUrl });
    }
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

function imageObjectToDataUrl(image: any): string | null {
  if (typeof image?.src === "string" && image.src.startsWith("data:image/")) return image.src;
  if (!image?.data || !image.width || !image.height) return null;

  const width = Number(image.width), height = Number(image.height), kind = Number(image.kind);
  const source = image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray ? image.data : new Uint8Array(image.data);
  let rgba: Uint8Array;

  if (kind === 3) rgba = Uint8Array.from(source);
  else if (kind === 2) {
    rgba = new Uint8Array(width * height * 4);
    for (let s = 0, d = 0; s + 2 < source.length && d + 3 < rgba.length; s += 3) {
      rgba[d++] = source[s]; rgba[d++] = source[s + 1]; rgba[d++] = source[s + 2]; rgba[d++] = 255;
    }
  } else if (kind === 1) {
    rgba = new Uint8Array(width * height * 4);
    let pixel = 0;
    for (const byte of source) {
      for (let bit = 7; bit >= 0 && pixel < width * height; bit--) {
        const value = (byte & (1 << bit)) ? 255 : 0, d = pixel * 4;
        rgba[d] = value; rgba[d + 1] = value; rgba[d + 2] = value; rgba[d + 3] = 255; pixel++;
      }
      if (pixel >= width * height) break;
    }
  } else return null;

  const paddedWidth = width + IMAGE_PADDING * 2;
  const paddedHeight = height + IMAGE_PADDING * 2;
  const rowSize = paddedWidth * 4;
  const scanlines = new Uint8Array((rowSize + 1) * paddedHeight);

  for (let y = 0; y < paddedHeight; y++) {
    const row = y * (rowSize + 1);
    scanlines[row] = 0;
    if (y < IMAGE_PADDING || y >= IMAGE_PADDING + height) {
      for (let x = 0; x < paddedWidth; x++) {
        const d = row + 1 + x * 4;
        scanlines[d + 3] = 0;
      }
      continue;
    }
    const sourceRow = (y - IMAGE_PADDING) * width * 4;
    for (let x = 0; x < paddedWidth; x++) {
      const d = row + 1 + x * 4;
      if (x < IMAGE_PADDING || x >= IMAGE_PADDING + width) {
        scanlines[d + 3] = 0;
      } else {
        const s = sourceRow + (x - IMAGE_PADDING) * 4;
        scanlines[d] = rgba[s];
        scanlines[d + 1] = rgba[s + 1];
        scanlines[d + 2] = rgba[s + 2];
        scanlines[d + 3] = rgba[s + 3];
      }
    }
  }

  const png = new Uint8Array([
    137,80,78,71,13,10,26,10,
    ...pngChunk("IHDR", new Uint8Array([paddedWidth >>> 24, paddedWidth >>> 16, paddedWidth >>> 8, paddedWidth, paddedHeight >>> 24, paddedHeight >>> 16, paddedHeight >>> 8, paddedHeight, 8, 6, 0, 0, 0])),
    ...pngChunk("IDAT", Uint8Array.from(deflateSync(scanlines))),
    ...pngChunk("IEND", new Uint8Array()),
  ]);
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}

function pngChunk(type: string, data: Uint8Array) {
  const typeBytes = Buffer.from(type, "ascii"), payload = new Uint8Array(typeBytes.length + data.length);
  payload.set(typeBytes); payload.set(data, typeBytes.length);
  const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
  view.setUint32(0, data.length); out.set(payload, 4); view.setUint32(8 + data.length, crc32(payload));
  return out;
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}

function getQuestionAnchors(items: Array<{ text: string; y: number }>): Anchor[] {
  const anchors: Anchor[] = [], regex = /^\s*(?:[（(]\s*)?(\d{1,3})(?:\s*[）)])?\s*(?:[.、．:：]|(?=\S))/;
  for (const item of items) { const match = item.text.match(regex); if (!match) continue; const number = Number(match[1]); if (number >= 1 && number <= 999) anchors.push({ number, y: item.y }); }
  return anchors;
}

function findImageNearQuestion(questionNumber: number, anchors: Anchor[], images: ImageAsset[]) {
  if (!anchors.length || !images.length) return null;
  const same = anchors.filter((anchor) => anchor.number === questionNumber);
  if (!same.length) return null;
  const target = same[0];
  const ordered = [...anchors].sort((a, b) => b.y - a.y);
  const targetIndex = ordered.findIndex((anchor) => anchor.number === questionNumber && Math.abs(anchor.y - target.y) < 0.5);
  const previous = targetIndex > 0 ? ordered[targetIndex - 1] : undefined;
  const next = targetIndex >= 0 && targetIndex < ordered.length - 1 ? ordered[targetIndex + 1] : undefined;
  const upper = previous?.y ?? target.y - 120;
  const nextBoundary = next?.y ?? target.y + 5000;
  return images.find((image) => {
    const y = image.y;
    if (targetIndex === 0) return y <= nextBoundary + 40;
    return y <= upper + 20 && y >= nextBoundary - 20;
  }) ?? null;
}
