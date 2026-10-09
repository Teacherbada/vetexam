import 'server-only';
import { createHash } from 'node:crypto';
import { MATERIAL_LIMITS, type MaterialPage } from './ai-material-input';

export async function extractMaterialPDF(bytes: Uint8Array): Promise<MaterialPage[]> {
  if (bytes.length > MATERIAL_LIMITS.maxFileBytes || Buffer.from(bytes.subarray(0,5)).toString() !== '%PDF-') throw new Error('請上傳 100 MB 以下的 PDF');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({data:bytes,isEvalSupported:false,useSystemFonts:true,disableFontFace:true});
  try {
    const doc = await task.promise;
    if (doc.numPages > MATERIAL_LIMITS.maxPages) throw new Error('教材最多 100 頁，請先分割 PDF');
    const pages: MaterialPage[] = []; let total = 0;
    for (let page = 1; page <= doc.numPages; page++) {
      const p = await doc.getPage(page), content = await p.getTextContent();
      let text = '', previousY: number | undefined;
      for (const item of content.items) { if (!('str' in item)) continue; const y = item.transform[5]; if (previousY !== undefined && Math.abs(previousY-y)>3) text += '\n'; text += item.str + (item.hasEOL ? '\n' : ' '); previousY=y; }
      text = text.replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim(); total += text.length;
      if (total > 250000 || text.length > 40000) throw new Error('教材文字過多，請先分割 PDF');
      const ops = await p.getOperatorList();
      const visual = ops.fnArray.some(op => [pdfjs.OPS.paintImageXObject,pdfjs.OPS.paintInlineImageXObject,pdfjs.OPS.constructPath].includes(op));
      const letters = (text.match(/[\p{L}\p{N}]/gu) || []).length;
      const usable = letters >= 60 && (text.match(/[\uFFFD\u0000-\u0008]/g) || []).length < Math.max(2,text.length*.01) && letters/Math.max(text.length,1) > .3;
      pages.push({page,text,hash:createHash('sha256').update(text).digest('hex'),usable,visual,
        warning:!usable ? '文字不足或品質異常：掃描頁請先 OCR，並人工校對後重新上傳。' : visual ? '含圖片或向量圖表；本版僅理解文字，依賴圖表的題目請人工處理。' : '請對照原頁確認文字順序；表格與公式可能擷取錯誤。'});
      p.cleanup();
    }
    return pages;
  } finally { await task.destroy(); }
}
