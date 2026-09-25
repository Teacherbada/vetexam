import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { auth } from "@/lib/auth";
import { parsePdfLayout, type PdfPage } from "@/lib/pdf-layout";
import { textLines, imageRegions } from "@/lib/pdf-geometry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_PAGES = 200;
type Visibility = "public" | "private";

export async function POST(request: Request) {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return NextResponse.json({ error: "伺服器資料庫設定錯誤" }, { status: 500 });
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user?.id) return NextResponse.json({ error: "請先登入才能上傳 PDF。" }, { status: 401 });
    const isAdmin = session?.user?.id === process.env.ADMIN_USER_ID?.trim();
    if (!isAdmin) return NextResponse.json({ error: "目前 PDF 解析功能僅限管理員使用。", code: "ADMIN_REQUIRED" }, { status: 403 });
    const formData = await request.formData();
    const file = formData.get("file");
    const visibilityValue = formData.get("visibility");
    const examYearValue = formData.get("examYear") ?? formData.get("exam_year");
    const examSubjectValue = formData.get("examSubject") ?? formData.get("exam_subject");
    if (!(file instanceof File)) return NextResponse.json({ error: "沒有收到 PDF 檔案" }, { status: 400 });
    const examYear = normalizeExamYear(Number(examYearValue));
    if (!examYear) return NextResponse.json({ error: "請選擇有效的國考年份。" }, { status: 400 });
    const examSubject = typeof examSubjectValue === "string" ? examSubjectValue.trim() : "";
    if (!examSubject) return NextResponse.json({ error: "請選擇國考科目。" }, { status: 400 });
    let visibility: Visibility = "private";
    if (visibilityValue === "public") {
      if (!process.env.ADMIN_USER_ID || process.env.ADMIN_USER_ID !== session.user.id) return NextResponse.json({ error: "目前只有管理員可以建立公開國考題庫。", code: "ADMIN_REQUIRED" }, { status: 403 });
      visibility = "public";
    }
    const subscriptions = await (await import("@neondatabase/serverless")).neon(databaseUrl)`SELECT plan, status, expires_at FROM subscriptions WHERE user_id = ${session.user.id} LIMIT 1`;
    const subscription = subscriptions[0];
    const isPro = subscription?.plan === "pro" && subscription?.status === "active" && (subscription?.expires_at == null || new Date(subscription.expires_at) > new Date());
    if (!isPro && !isAdmin) return NextResponse.json({ error: "目前只有 PRO 會員可以上傳 PDF 題庫。", code: "PRO_REQUIRED" }, { status: 403 });
    if (file.type !== "application/pdf") return NextResponse.json({ error: "目前只接受 PDF 檔案" }, { status: 400 });
    if (file.size === 0) return NextResponse.json({ error: "PDF 檔案是空的" }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "PDF 檔案太大", detail: "目前單一 PDF 最大限制為 10 MB。" }, { status: 413 });

    const pdfBytes = new Uint8Array(await file.arrayBuffer());
    const fileHash = createHash("sha256").update(pdfBytes).digest("hex");
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjsLib.getDocument({ data: pdfBytes, standardFontDataUrl: `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`, useSystemFonts: false }).promise;
    if (pdf.numPages > MAX_PAGES) { await pdf.destroy(); return NextResponse.json({ error: "PDF 頁數太多", detail: `目前單一 PDF 最大限制為 ${MAX_PAGES} 頁。` }, { status: 413 }); }

    const pages: PdfPage[] = [];
    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        try {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        const info: PdfPage = { page: pageNumber, width: viewport.width, height: viewport.height, lines: [], images: [] };
        try { info.lines = textLines((await page.getTextContent()).items.filter(item => "str" in item), viewport); }
        catch { info.warning = '文字擷取失敗'; }
        try { info.images = imageRegions(pdfjsLib.OPS, await page.getOperatorList(), viewport, pageNumber); }
        catch { info.warning = '圖片偵測失敗'; }
        pages.push(info);
        page.cleanup();
        } catch {
          pages.push({ page: pageNumber, width: 0, height: 0, lines: [], images: [], warning: '頁面無法讀取，請對照原 PDF 手動補題' });
        }
      }
    } finally { await pdf.destroy(); }
    const text = pages.flatMap(p => p.lines.map(l => l.text)).join('\n');
    const questions = parsePdfLayout(pages);
    if (!questions.length) return NextResponse.json({ error: '沒有辨識到題號。純掃描 PDF 尚未支援 OCR，請使用手動輸入。', textPreview: text.slice(0, 5000), warnings: pages.filter(p=>p.warning).map(p=>({page:p.page,warning:p.warning})) }, { status: 400 });
    const imagePages = new Set(pages.filter(p=>p.images.length).map(p=>p.page));
    const imageQuestionCount=questions.filter(q=>q.hasImage).length;
    const detectedOptionCounts=questions.map(q=>q.options.length);
    const optionCountFrequency=new Map<number,number>();
    for(const count of detectedOptionCounts) optionCountFrequency.set(count,(optionCountFrequency.get(count)??0)+1);
    const detectedOptionCount=[...optionCountFrequency.entries()].sort((a,b)=>b[1]-a[1]||b[0]-a[0])[0]?.[0]??4;
    return NextResponse.json({success:true,pendingConfirmation:true,message:`成功辨識 ${questions.length} 題${imageQuestionCount?`，其中 ${imageQuestionCount} 題偵測到圖片`:""}`,fileHash,filename:file.name,visibility,examYear,examSubject,total:questions.length,questions,imagePages:[...imagePages],imageQuestionCount,imageQuestionNumbers:questions.filter(q=>q.hasImage).map(q=>q.id),detectedOptionCount,textLength:text.length,totalPages:pages.length,parserVersion:2,pageWarnings:pages.filter(p=>p.warning).map(p=>({page:p.page,warning:p.warning}))});
  } catch(error) { console.error("PDF parsing error:",error); return NextResponse.json({error:"PDF 解析失敗",detail:error instanceof Error?error.message:"未知錯誤"},{status:500}); }
}

function normalizeExamYear(value:number){if(!Number.isInteger(value))return null;const year=value>=80&&value<=200?value+1911:value;return year>=1990&&year<=2100?year:null;}
