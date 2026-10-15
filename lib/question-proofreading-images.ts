import 'server-only';
import {createCanvas,loadImage} from '@napi-rs/canvas';

export function rasterData(src:string){return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(src);}
/** Same stacked PNG contract as PDF ReviewImages; never fetch arbitrary remote URLs. */
export async function composeProofImages(sources:string[]):Promise<string|null>{
  if(!sources.length)return null;
  let pixels=0;
  const loaded=[];
  for(const src of sources){
    if(!rasterData(src))throw Error('無法安全合併舊圖片連結，請下載核對後重新上傳 PNG／JPEG／WebP');
    const bytes=Buffer.from(src.slice(src.indexOf(',')+1),'base64');
    const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    const webp=bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
    if(!(src.startsWith('data:image/png;')&&png||src.startsWith('data:image/jpeg;')&&jpeg||src.startsWith('data:image/webp;')&&webp))throw Error('圖片檔案內容與格式不符，請重新匯出原圖');
    if(png&&(bytes.length<24||bytes.readUInt32BE(16)*bytes.readUInt32BE(20)>32_000_000))throw Error('圖片尺寸過大');
    const image=await loadImage(bytes);
    pixels+=image.width*image.height;
    if(!image.width||!image.height||pixels>32_000_000||image.width>12000||image.height>32000)throw Error('圖片尺寸過大，請先整理原圖');
    loaded.push(image);
  }
  if(sources.length===1)return sources[0];
  const width=Math.max(...loaded.map(i=>i.width)),height=loaded.reduce((n,i)=>n+i.height,0)+(loaded.length-1)*16;
  if(width*height>32_000_000||height>32000)throw Error('合併圖片尺寸過大，原圖尚未儲存');
  const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
  let y=0;for(const img of loaded){ctx.drawImage(img,Math.floor((width-img.width)/2),y);y+=img.height+16;}
  const result=canvas.toDataURL('image/png');if(result.length>3_400_000)throw Error('合併後圖片超過安全傳輸大小，請先縮小圖片');return result;
}
