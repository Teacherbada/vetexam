import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync(new URL('../lib/learning-trends.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {learningTrends}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const now=Date.parse('2026-09-25T12:00:00Z'),day=86400000;
const row=(id,days,correct=true)=>({question_id:id,subject:'subject',is_correct:correct,answered_at:new Date(now-days*day).toISOString()});
test('no or small samples hide trends; repeated answers do not manufacture sample size',()=>{
  for(const rows of [[],[row(1,1)],Array.from({length:30},()=>row(1,1))])assert.equal(learningTrends(rows,now).recent.accuracy,null);
});
test('half-open weekly boundaries, month and latest per question are deterministic',()=>{
  const rows=Array.from({length:10},(_,i)=>row(i+1,1,i<8));
  rows.push(...Array.from({length:10},(_,i)=>row(i+1,8,i<5)),row(50,7),row(51,14),row(52,30),row(53,31),row(54,-1));
  const result=learningTrends(rows,now);
  assert.equal(result.recent.count,11);assert.equal(result.previous.count,11);assert.equal(result.month.count,13);assert.equal(result.all.count,14);
  assert.ok(Math.abs(result.change-(9/11-6/11)*100)<1e-9);
  assert.deepEqual(learningTrends([...rows].reverse(),now),result);
});
