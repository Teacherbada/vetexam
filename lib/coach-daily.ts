import {EXAM_SUBJECTS,validChapter} from '../data/exam-chapters';
import type {DailyCandidate} from './daily-task';
export const COACH_GROUPS=['weakness','review','challenge'] as const;
export type CoachGroup=typeof COACH_GROUPS[number];
export const COACH_NAMES:Record<CoachGroup,string>={weakness:'弱點特訓',review:'記憶複習',challenge:'綜合挑戰'};
export const COACH_RULES={recentDays:30,avoidDays:7,chapterMinimum:5,subjectMinimum:10,weakAccuracy:0.7,diagnosticMinimum:12,diagnosticSubjects:3,weakRatio:0.35,reviewRatio:0.25} as const;
export type CoachEvidence={id:number;subject:string;chapter:string|null;correct:boolean;wrong_count:number;last_answered:string;due:string|null;last_review:string|null};
export type CoachTarget={subject:string;chapter:string|null;count:number;correct:number;repeated:number};
export type CoachPlan={version:2;asOf:string;evidenceCount:number;groups:{key:CoachGroup;reason:string;positions:number[];focus:string[];repeated:number}[]};
export type CoachFeedback={answered:number;correct:number;accuracy:number|null;strong:string[];revisit:string[];comment:string;next:string};
export type CoachItem={position:number;subject:string;chapter:string|null;selected_answer:string|null;is_correct:boolean|null;question:string;options:string[];image:string|null};
export type CoachGroupView=CoachPlan['groups'][number]&{total:number;answered:number;completed:boolean;current:{position:number;question:string;options:string[];image:string|null}|null;feedback:CoachFeedback|null};
const key=(s:string,c:string|null)=>JSON.stringify([s,c]);
const chapter=(r:{subject:string;chapter:string|null})=>r.chapter&&validChapter(r.subject,r.chapter)?r.chapter:null;
export function coachTargets(evidence:CoachEvidence[]):CoachTarget[]{
 const groups=new Map<string,CoachTarget>();
 for(const e of evidence){if(!EXAM_SUBJECTS.includes(e.subject))continue;
  for(const c of [null,...(chapter(e)?[chapter(e)]:[])]){const k=key(e.subject,c),g=groups.get(k)??{subject:e.subject,chapter:c,count:0,correct:0,repeated:0};g.count++;g.correct+=Number(e.correct);g.repeated+=Number(e.wrong_count>=2);groups.set(k,g);}
 }
 return [...groups.values()].filter(g=>g.count>=(g.chapter?COACH_RULES.chapterMinimum:COACH_RULES.subjectMinimum)&&g.correct/g.count<COACH_RULES.weakAccuracy)
  .sort((a,b)=>a.correct/a.count-b.correct/b.count||b.repeated-a.repeated||b.count-a.count||a.subject.localeCompare(b.subject));
}
export function coachNeedsDiagnostic(evidence:CoachEvidence[],initialCompleted:boolean){return !initialCompleted&&(evidence.length<COACH_RULES.diagnosticMinimum||new Set(evidence.map(e=>e.subject)).size<COACH_RULES.diagnosticSubjects);}
export function coachQuotas(target:number){return {weakness:Math.max(1,Math.floor(target*COACH_RULES.weakRatio)),review:Math.max(1,Math.floor(target*COACH_RULES.reviewRatio))};}
export function selectCoachQuestions(candidates:DailyCandidate[],target:number,reserved:number[],evidence:CoachEvidence[],now:number,memory:ReadonlyMap<number,{due:string;last_review:string|null}>=new Map()){
 const pool=[...new Map(candidates.filter(c=>EXAM_SUBJECTS.includes(c.subject)).map(c=>[c.id,c])).values()];
 const used=new Set(reserved),history=new Map(evidence.map(e=>[e.id,e])),targets=coachTargets(evidence),quota=coachQuotas(target);
 const selected:{row:DailyCandidate;group:CoachGroup}[]=[],reasons:Record<CoachGroup,string>={
  weakness:targets.length?'依最近 30 天的不同題目表現與重複錯誤，優先練習樣本足夠且正確率較低的範圍。':'目前正在建立你的學習分析；尚無樣本足夠的弱點，不以少量錯題判定弱科。配額改用綜合挑戰。',
  review:'目前沒有適合的錯題或到期複習，配額改用綜合挑戰。',
  challenge:'混合不同科目，優先選擇未練習或較久未練習的題目，確認本次理解情況。'};
 const time=(c:DailyCandidate)=>Math.max(Date.parse(c.last_seen??'')||0,Date.parse(history.get(c.id)?.last_answered??'')||0);
 const recent=(c:DailyCandidate)=>Number(time(c)>=now-COACH_RULES.avoidDays*86400000);
 const sort=(a:DailyCandidate,b:DailyCandidate)=>recent(a)-recent(b)||time(a)-time(b)||a.appearances-b.appearances||a.id-b.id;
 const take=(rows:DailyCandidate[],count:number,group:CoachGroup)=>{for(const row of rows){if(count<=0||selected.length+reserved.length>=target)break;if(used.has(row.id))continue;used.add(row.id);selected.push({row,group});count--;}};
 // Choose a reliable chapter first; expand within the same subject only if necessary.
 const focus=targets.find(t=>t.chapter)??targets[0];
 if(focus){const exact=pool.filter(c=>c.subject===focus.subject&&(!focus.chapter||chapter(c)===focus.chapter)).sort(sort);
  take(exact,quota.weakness,'weakness');const n=selected.length;
  if(n<quota.weakness)take(pool.filter(c=>c.subject===focus.subject).sort(sort),quota.weakness-n,'weakness');
  reasons.weakness=`最近 30 天「${focus.subject}${focus.chapter?'－'+focus.chapter:''}」${focus.count} 道不同題目答對 ${focus.correct} 題，${focus.repeated} 題曾重複答錯。優先加強此範圍；題量不足時補同科其他章節。`;
 }
 const due=pool.flatMap(c=>{const m=memory.get(c.id),e=history.get(c.id);return m&&Date.parse(m.due)<=now&&(!e||!m.last_review||Date.parse(e.last_answered)<=Date.parse(m.last_review))?[e??{...c,correct:true,wrong_count:0,last_answered:m.last_review??'',...m}]:[];});
 const wrong=evidence.filter(e=>!e.correct).sort((a,b)=>b.wrong_count-a.wrong_count||Date.parse(b.last_answered)-Date.parse(a.last_answered));
 const anchors=[...new Map([...due,...wrong].map(e=>[e.id,e])).values()],anchorIds=new Set(anchors.map(e=>e.id));
 const matching=new Set(anchors.filter(e=>chapter(e)).map(e=>key(e.subject,chapter(e))));
 const reviewPool=pool.filter(c=>anchorIds.has(c.id)||matching.has(key(c.subject,chapter(c))));
 reviewPool.sort((a,b)=>Number(anchorIds.has(a.id))-Number(anchorIds.has(b.id))||sort(a,b));
 take(reviewPool,Math.max(0,quota.review-reserved.length),'review');
 if(anchors.length||reserved.length)reasons.review=`依${[reserved.length?'既有到期章節追蹤':'',due.length?'到期記憶':'',wrong.length?'近期錯題':''].filter(Boolean).join('、')}安排。優先選同章節其他題目，題量不足的配額轉為綜合挑戰；目前只比對章節，不推測相同考點。`;
 // Balance the remaining quota across subjects, without duplicating IDs in the day.
 const counts=new Map<string,number>();
 while(selected.length+reserved.length<target){const rest=pool.filter(c=>!used.has(c.id)).sort((a,b)=>recent(a)-recent(b)||(counts.get(a.subject)??0)-(counts.get(b.subject)??0)||sort(a,b));if(!rest.length)break;
  take([rest[0]],1,'challenge');counts.set(rest[0].subject,(counts.get(rest[0].subject)??0)+1);}
 return {selected,reasons,evidenceCount:evidence.length};
}
export function coachFeedback(rows:CoachItem[]):CoachFeedback{
 const answered=rows.filter(r=>r.selected_answer!==null),correct=answered.filter(r=>r.is_correct).length,groups=new Map<string,{count:number;correct:number}>();
 for(const r of answered){const label=r.subject+(chapter(r)?'－'+chapter(r):'（未分類章節）'),g=groups.get(label)??{count:0,correct:0};g.count++;g.correct+=Number(r.is_correct);groups.set(label,g);}
 const strong=[...groups].filter(([,g])=>g.count>=3&&g.correct/g.count>=0.8).map(([label,g])=>`${label}：${g.correct}/${g.count}`);
 const revisit=[...groups].filter(([,g])=>g.correct<g.count).sort((a,b)=>(a[1].correct/a[1].count)-(b[1].correct/b[1].count)).map(([label,g])=>`${label}：${g.count-g.correct} 題答錯`);
 return {answered:answered.length,correct,accuracy:answered.length?Math.round(correct/answered.length*100):null,strong,revisit,
  comment:!answered.length?'尚未作答，完成後會依實際結果給你回饋。':`本次完成 ${answered.length} 題，答對 ${correct} 題。${answered.length<5?'樣本仍少，先累積更多不同題目的表現。':'這是本次表現，完成訓練不等於已精熟，也不據此宣稱長期進步。'}`,
  next:revisit.length?`下次先複習「${revisit[0]}」相關教材，再以其他題目確認理解；明日依最新紀錄重新安排。`:'下次繼續跨科練習並檢查到期複習，累積更多證據；明日依最新紀錄重新安排。'};
}
export function coachGroupViews(plan:CoachPlan,rows:CoachItem[]):CoachGroupView[]{return plan.groups.map(group=>{
 const own=rows.filter(r=>group.positions.includes(r.position)),pending=own.find(r=>r.selected_answer===null),answered=own.filter(r=>r.selected_answer!==null).length,completed=own.length>0&&!pending;
 return {...group,total:own.length,answered,completed,current:pending?{position:pending.position,question:pending.question,options:pending.options,image:pending.image}:null,feedback:completed?coachFeedback(own):null};
});}
