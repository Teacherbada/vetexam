import {readFileSync} from 'node:fs';
import * as canvas from '@napi-rs/canvas';
import {randomUUID} from 'node:crypto';
import {fixture as base,load,adminService} from './multiple-answers-fixture.mjs';
import {http} from './official-explanation-fixture.mjs';
export const input=load('lib/question-proofreading-input.ts');
export const images=load('lib/question-proofreading-images.ts',{'@napi-rs/canvas':canvas});
export const service=load('lib/question-proofreading.ts',{'./admin-questions':adminService,'./question-proofreading-input':input,'./question-proofreading-images':images});
export function png(color){const c=canvas.createCanvas(4,4),ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,4,4);return c.toDataURL('image/png');}
export async function fixture(count=3){
 const f=await base();await f.db.exec(readFileSync(new URL('../../migrations/20261014_question_proofreading.sql',import.meta.url),'utf8'));
 await f.query('UPDATE question_sets SET total_questions=$1 WHERE id=1',[count]);
 await f.query("UPDATE questions SET question='完整的官方測試題幹，請選擇正確敘述。' WHERE question_set_id=1");
 for(let n=4;n<=count;n++)await f.query(`INSERT INTO questions(question_set_id,question_number,subject,question,option_a,option_b,option_c,option_d,answer,explanation) VALUES(1,$1::int,'獸醫病理學','完整的官方測試題幹第 '||($1::int)::text||' 題，請選擇。','甲','乙','丙','丁','A','')`,[n]);
 const sql={query:f.query};
 const admin=load('lib/admin.ts',{'@/lib/auth':{auth:{api:{getSession:async({headers})=>{const id=headers.get('x-test-user');return id?{user:{id}}:null;}}}},'@neondatabase/serverless':{neon:()=>sql}});
 const route=load('app/api/admin/questions/proofread/route.ts',{'@/lib/admin':admin,'@/lib/admin-question-http':http,'@/lib/admin-questions':adminService,'@/lib/question-transaction':{questionTransaction:f.transaction},'@/lib/question-proofreading':service,'@/lib/question-proofreading-input':input});
 return {...f,route,detail:id=>service.proofDetail(f.query,id),bank:()=>service.proofBank(f.query,1),save:body=>f.transaction(tx=>service.changeProof(tx,body,'admin'))};
}
export function payload(q,extra={}){return {action:'save',id:q.id,revision:q.revision,requestId:randomUUID(),question:q.question,options:q.options,answer:q.answer,explanation:q.explanation,images:q.images.map(({questionId,index,revision})=>({questionId,index,revision})),confirmAnswer:true,confirmExplanation:true,...extra};}
