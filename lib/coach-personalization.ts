import {EXAM_SUBJECTS, validChapter} from '../data/exam-chapters';
import type {CoachItem, CoachPlan} from './coach-daily';

export const REVIEW_INTERVALS = [3, 7, 14, 30] as const;
export const BUSY_TARGET = 5;
export type ChapterReview = {subject:string;chapter:string;due:string;lastDate:string;step:number;failures:number;lapses:number;questionId:number;lastCorrect:boolean};
export type CoachState = {version:1;focus?:{week:string;subject:string|null};reviews:Record<string,ChapterReview>};
export function emptyCoachState():CoachState {return {version:1,reviews:{}};}
export function reviewKey(subject:string,chapter:string) {return JSON.stringify([subject,chapter]);}
export function addDays(date:string,days:number) {return new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);}
export function coachWeek(date:string) {const day=new Date(date+'T00:00:00Z').getUTCDay();return addDays(date,-((day+6)%7));}
export function focusForWeek(state:CoachState,date:string) {return state.focus?.week===coachWeek(date)&&EXAM_SUBJECTS.includes(state.focus.subject??'')?state.focus.subject!:null;}

// One entry per chapter, not a new pending task on every wrong answer.
// A chapter can advance only once per local day. Any wrong answer resets it.
export function reviewAfterAnswer(previous:ChapterReview|undefined,input:{subject:string;chapter:string;questionId:number;correct:boolean;date:string}):ChapterReview|undefined {
 if(!validChapter(input.subject,input.chapter)||!input.chapter)return previous;
 if(input.correct&&!previous)return undefined;
 if(previous&&input.date<previous.lastDate)return previous;
 const base={subject:input.subject,chapter:input.chapter,questionId:input.questionId};
 if(!input.correct)return {...base,due:addDays(input.date,1),lastDate:input.date,step:0,failures:(previous?.failures??0)+1,lapses:(previous?.lapses??0)+Number(Boolean(previous?.lastCorrect&&input.date>=previous.due)),lastCorrect:false};
 if(!previous||input.date<=previous.lastDate||input.date<previous.due)return previous;
 const step=Math.min(previous.step+1,REVIEW_INTERVALS.length);
 return {...previous,...base,due:addDays(input.date,REVIEW_INTERVALS[step-1]),lastDate:input.date,step,lastCorrect:true};
}
export function dueReviews(state:CoachState,date:string) {return Object.values(state.reviews).filter(r=>r.due<=date&&validChapter(r.subject,r.chapter)).sort((a,b)=>a.due.localeCompare(b.due)||b.lapses-a.lapses||b.failures-a.failures);}
export function busyPositions(plan:CoachPlan,rows:CoachItem[]) {
 const pending=new Set(rows.filter(r=>r.selected_answer===null).map(r=>r.position));
 return ['review','weakness','challenge'].flatMap(key=>plan.groups.find(g=>g.key===key)?.positions.filter(p=>pending.has(p))??[]).slice(0,BUSY_TARGET);
}

export type TrendRow={id:number;subject:string;chapter:string|null;period:'current'|'previous';correct:boolean;fingerprint?:string};
export type ChapterTrend={subject:string;chapter:string;count:number;before:number;after:number;change:number};
export type CoachReport={date:string;week:string;focus:string|null;due:{subject:string;chapter:string;due:string;failures:number;lapses:number}[];upcoming:{subject:string;chapter:string;due:string}[];weekStats:{answered:number;correct:number;completedDays:number;reviewTotal:number;reviewDone:number};weak:{subject:string;chapter:string|null;count:number;correct:number;repeated:number}[];trends:ChapterTrend[]};
export function comparableTrends(rows:TrendRow[]):ChapterTrend[] {
 const old=new Map(rows.filter(r=>r.period==='previous').map(r=>[r.id,r]));
 const groups=new Map<string,{subject:string;chapter:string;count:number;before:number;after:number}>();
 for(const row of rows.filter(r=>r.period==='current')) {
  const prior=old.get(row.id);
  if(!prior||!row.chapter||!validChapter(row.subject,row.chapter)||prior.subject!==row.subject||prior.chapter!==row.chapter||prior.fingerprint!==row.fingerprint)continue;
  const k=reviewKey(row.subject,row.chapter),g=groups.get(k)??{subject:row.subject,chapter:row.chapter,count:0,before:0,after:0};
  g.count++;g.before+=Number(prior.correct);g.after+=Number(row.correct);groups.set(k,g);
 }
 return [...groups.values()].filter(g=>g.count>=5).map(g=>({...g,change:Math.round(100*(g.after-g.before)/g.count)}));
}
