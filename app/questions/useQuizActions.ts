"use client";
import {useEffect,useRef} from 'react';

// Only the standard quiz opts in. Reserve the measured bar height, including
// safe-area padding and text zoom, for both the content and the trailing links.
export default function useQuizActions(active:boolean,questionId:number|undefined){
 const actions=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const bar=actions.current;if(!active||!bar)return;
  const root=document.documentElement,property='--vetexam-quiz-actions-height',previous=root.style.getPropertyValue(property);
  const media=window.matchMedia('(max-width: 600px)'),viewport=window.visualViewport;
  let fullHeight=window.innerHeight,frame=0;
  const measure=()=>{
   root.style.setProperty(property,media.matches?`${bar.getBoundingClientRect().height}px`:'0px');
   const focused=document.activeElement,editing=focused instanceof HTMLElement&&(focused.matches('input,textarea')||focused.isContentEditable);
   if(!editing)fullHeight=window.innerHeight;
   const reduced=fullHeight-(viewport?.height??window.innerHeight);
   // Do not cover an editable field or keyboard. Browser resize/overlay modes
   // both work, and pinch zoom alone does not trigger the keyboard treatment.
   bar.dataset.keyboardOpen=String(media.matches&&editing&&reduced>120&&(!viewport||viewport.scale===1));
  };
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);};
  const observer=new ResizeObserver(measure);observer.observe(bar,{box:'border-box'});measure();
  media.addEventListener('change',schedule);window.addEventListener('resize',schedule);
  viewport?.addEventListener('resize',schedule);viewport?.addEventListener('scroll',schedule);
  document.addEventListener('focusin',schedule);document.addEventListener('focusout',schedule);
  return()=>{observer.disconnect();cancelAnimationFrame(frame);media.removeEventListener('change',schedule);window.removeEventListener('resize',schedule);viewport?.removeEventListener('resize',schedule);viewport?.removeEventListener('scroll',schedule);document.removeEventListener('focusin',schedule);document.removeEventListener('focusout',schedule);if(previous)root.style.setProperty(property,previous);else root.style.removeProperty(property);};
 },[active,questionId]);
 return actions;
}
