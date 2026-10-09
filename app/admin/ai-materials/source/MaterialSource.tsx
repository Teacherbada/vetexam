'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {MATERIAL_LIMITS} from '@/lib/ai-material-input';
import {fetchAI} from '@/lib/ai-question-client';
import styles from '../../questions/questions.module.css';
export default function MaterialSource({id}:{id:string}){
  const [url,setUrl]=useState(''),[status,setStatus]=useState('正在讀取私人教材…');
  useEffect(()=>{
    let active=true,objectURL='';
    void(async()=>{
      try{
        const base='/api/admin/ai-materials?material='+id;
        const metadata=await fetchAI(base,{cache:'no-store'});if(!metadata.ok)throw new Error('只有管理員能讀取此教材，請確認登入狀態');
        const {material}=await metadata.json(),size=material.byte_length;
        if(!Number.isSafeInteger(size)||size<5||size>MATERIAL_LIMITS.maxFileBytes)throw new Error('教材大小無效');
        const chunks:Uint8Array<ArrayBuffer>[]=[];
        for(let part=0;part<Math.ceil(size/MATERIAL_LIMITS.chunkBytes);part++){
          if(!active)return;
          const response=await fetchAI(base+'&pdf=1&part='+part,{cache:'no-store'});if(!response.ok)throw new Error('教材讀取失敗，請重新整理');
          const bytes=new Uint8Array(await response.arrayBuffer());
          if(bytes.length!==Math.min(MATERIAL_LIMITS.chunkBytes,size-part*MATERIAL_LIMITS.chunkBytes))throw new Error('教材分段長度不符');
          chunks.push(bytes);if(active)setStatus('讀取私人教材 '+Math.round((part+1)/Math.ceil(size/MATERIAL_LIMITS.chunkBytes)*100)+'%');
        }
        if(!active)return;
        objectURL=URL.createObjectURL(new Blob(chunks,{type:'application/pdf'}));
        const page=Number(new URLSearchParams(window.location.hash.slice(1)).get('page'))||1;
        setUrl(objectURL+'#page='+Math.max(1,Math.min(material.pages.length,page)));setStatus('私人教材僅供管理員審核。');
      }catch(e){if(active)setStatus(e instanceof Error?e.message:'教材讀取失敗');}
    })();
    return()=>{active=false;if(objectURL)URL.revokeObjectURL(objectURL);};
  },[id]);
  return <main className={styles.page}><div className={styles.container}><h1>教材原始頁面</h1><Link href="/admin/ai-materials">返回教材出題</Link><p role="status">{status}</p>{url&&<><a href={url} target="_blank" rel="noopener noreferrer">在 PDF 檢視器開啟（限本機此分頁）</a><iframe title="私人教材 PDF" src={url} style={{width:'100%',height:'80vh',border:0}}/></>}</div></main>;
}
