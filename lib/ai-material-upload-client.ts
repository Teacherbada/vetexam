import {fetchAI} from './ai-question-client';
import {MATERIAL_LIMITS} from './ai-material-input';
export async function uploadLargeMaterial(file:File,id:string,onProgress:(message:string)=>void){
  if(file.size>MATERIAL_LIMITS.maxFileBytes)throw new Error('PDF 最多 100 MB');
  async function post(body:unknown,timeout=55000){const r=await fetchAI('/api/admin/ai-materials/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},timeout);const d=await r.json();if(!r.ok)throw new Error(d.error||'上傳失敗，請選取同一檔案續傳');return d;}
  const begun=await post({action:'begin',id,filename:file.name,size:file.size});
  if(begun.chunkBytes!==MATERIAL_LIMITS.chunkBytes)throw new Error('上傳設定已更新，請重新整理');
  if(begun.status!=='done')for(let position=0;position<Math.ceil(file.size/MATERIAL_LIMITS.chunkBytes);position++){
    if(begun.received.includes(position))continue;
    const bytes=new Uint8Array(await file.slice(position*MATERIAL_LIMITS.chunkBytes,(position+1)*MATERIAL_LIMITS.chunkBytes).arrayBuffer());
    let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    await post({action:'chunk',id,position,data:btoa(binary)});
    onProgress('教材上傳 '+Math.round(Math.min((position+1)*MATERIAL_LIMITS.chunkBytes,file.size)/file.size*100)+'%；此步驟不呼叫 AI。');
  }
  onProgress('上傳完成，正在擷取文字；此步驟不呼叫 AI。');
  return post({action:'finish',id},305000);
}
