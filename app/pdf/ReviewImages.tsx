'use client';

import { useEffect, useState } from 'react';
import ImagePreview from './ImagePreview';
import ImageViewer from '@/components/ui/ImageViewer';
import type { PdfRegion } from '@/lib/pdf-layout';

export type ReviewImage = { src: string; region?: PdfRegion };
export type ImageQuestion = { id: number; questionNumber?: number; pageNumber?: number; hasImage?: boolean; imageDataUrl?: string | null; images?: ReviewImage[]; regions?: PdfRegion[] };

/** Preserve every pixel in all figures; the public UI continues to receive one PNG. */
export async function combineImages(images: ReviewImage[]): Promise<string | null> {
  if (!images.length) return null;
  if (images.length === 1) return images[0].src;
  const loaded = await Promise.all(images.map(image => new Promise<HTMLImageElement>((resolve,reject)=>{
    const item = new Image(); item.onload=()=>resolve(item); item.onerror=()=>reject(new Error('圖片讀取失敗，請重新上傳。')); item.src=image.src;
  })));
  const width=Math.max(...loaded.map(i=>i.naturalWidth));
  const height=loaded.reduce((sum,i)=>sum+i.naturalHeight,0)+(loaded.length-1)*16;
  if (width*height>32_000_000 || height>32000) throw new Error('多圖尺寸過大，請手動整理圖片後上傳；原圖已保留。');
  const canvas=document.createElement('canvas'); canvas.width=width; canvas.height=height;
  const context=canvas.getContext('2d'); if(!context) throw new Error('無法建立圖片預覽');
  context.fillStyle='#fff'; context.fillRect(0,0,width,height);
  let y=0; for(const item of loaded){context.drawImage(item,Math.floor((width-item.naturalWidth)/2),y); y+=item.naturalHeight+16;}
  return canvas.toDataURL('image/png');
}

export default function ReviewImages({question:q,questions,file,onImages,onCombined,onMove}:{
  question:ImageQuestion; questions:ImageQuestion[]; file:File|null;
  onImages:(id:number,images:ReviewImage[])=>void;
  onCombined:(id:number,url:string|null)=>void;
  onMove:(from:number,to:number,index:number)=>void;
}) {
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!q.images)return;
    let cancelled=false;
    combineImages(q.images).then(url=>{if(!cancelled){setError('');onCombined(q.id,url)}}).catch(e=>{if(!cancelled)setError(e.message)});
    return ()=>{cancelled=true};
  },[q.id,q.images,onCombined]);
  if(q.images===undefined && q.hasImage && !q.imageDataUrl) return <ImagePreview file={file} pageNumber={q.pageNumber} questionNumber={q.questionNumber ?? q.id} regions={q.regions} onImageLoaded={(_,urls)=>onImages(q.id,urls.map((src,i)=>({src,region:q.regions?.[i]})))}/>;
  const images=q.images ?? (q.imageDataUrl?[{src:q.imageDataUrl}]:[]);
  return <div className="mt-3 space-y-4">{error&&<p role="alert" className="text-red-700">{error}</p>}{images.map((image,i)=><div key={i} className="min-w-0 rounded-xl border border-[#E8EBE8] p-3">
    <ImageViewer src={image.src} alt={`第 ${q.questionNumber ?? q.id} 題圖片 ${i+1}`} />
    <p className="my-2 text-xs text-[#6F7873]">圖片 {i+1}{image.region?` · 第 ${image.region.page} 頁 · ${image.region.source} · ${Math.round(image.region.width)} × ${Math.round(image.region.height)}`:''}</p>
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button type="button" className="rounded-lg border p-2" onClick={()=>onImages(q.id,images.filter((_,j)=>j!==i))}>移除圖片 {i+1}</button>
      {i>0&&<button type="button" className="rounded-lg border p-2" onClick={()=>{const next=[...images];[next[i-1],next[i]]=[next[i],next[i-1]];onImages(q.id,next)}}>上移圖片 {i+1}</button>}
      <select className="min-w-0 max-w-full rounded-lg border p-2" aria-label={`圖片 ${i+1} 改配到其他題`} value="" onChange={e=>{if(e.target.value)onMove(q.id,Number(e.target.value),i)}}><option value="">改配到其他題…</option>{questions.filter(other=>other.id!==q.id).map(other=><option key={other.id} value={other.id}>第 {other.questionNumber ?? other.id} 題</option>)}</select>
    </div>
  </div>)}</div>;
}
