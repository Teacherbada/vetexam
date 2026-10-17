"use client";

import {useLayoutEffect,useRef} from 'react';
import {StudyIcon} from '@/components/dashboard/StudyUI';
import styles from './LoadingScreen.module.css';

export default function LoadingScreen({active=true,variant='home'}:{active?:boolean;variant?:'home'|'quiz'}){
 const screen=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const node=screen.current;if(!active||!node)return;
  const previous=document.activeElement,locked:HTMLElement[]=[];
  // Temporarily disable background controls without changing widths/scrollbars.
  for(let branch:HTMLElement|null=node;branch&&branch!==document.body;branch=branch.parentElement){
   for(const sibling of branch.parentElement?.children??[]){
    if(sibling!==branch&&sibling instanceof HTMLElement&&!sibling.inert&&!sibling.matches('script,style,link')){sibling.inert=true;locked.push(sibling);}
   }
  }
  node.focus({preventScroll:true});
  const preventScroll=(event:WheelEvent)=>event.preventDefault();
  node.addEventListener('wheel',preventScroll,{passive:false});
  return()=>{for(const element of locked)element.inert=false;node.removeEventListener('wheel',preventScroll);if(previous instanceof HTMLElement&&previous!==document.body&&previous.isConnected)previous.focus({preventScroll:true});};
 },[active]);
 return <div ref={screen} className={styles.screen} data-active={active} data-brand-loading={variant} role="status" aria-live="polite" aria-hidden={!active} inert={!active} tabIndex={-1} onKeyDown={event=>{if([' ','ArrowDown','ArrowUp','PageDown','PageUp','Home','End'].includes(event.key))event.preventDefault();}}>
  <div className={styles.content}>
   <div className={styles.brand}><span><StudyIcon name="paw" /></span><strong>VetExam</strong></div>
   <p className={styles.subtitle}>刷題，讓你更近夢想</p>
   <div className={styles.dots} aria-hidden="true"><i/><i/><i/></div>
   <p className={styles.message}>{variant==='home'?'正在準備你的學習空間…':'正在準備題目…'}</p>
  </div>
 </div>;
}
