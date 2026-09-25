import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync(new URL('../lib/learning-priorities.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {learningPriorities}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const answers=(chapter,count,correct,offset=0)=>Array.from({length:count},(_,i)=>({question_id:offset+i,subject:'s',chapter,is_correct:i<correct,answered_at:'2026-09-25T00:00:00Z'}));
const freq=(chapter,count)=>({subject:'s',chapter,count,papers:10,share:count/100,average:count/10});
test('frequent 55 percent chapter outranks rare 40 percent chapter',()=>{
  const result=learningPriorities([...answers('rare',20,8),...answers('frequent',20,11,100)],[freq('rare',2),freq('frequent',50)]);
  assert.equal(result[0].chapter,'frequent');assert.equal(result[0].high,true);
});
test('small samples, unknown chapters and already mastered chapters are excluded',()=>{
  assert.deepEqual(learningPriorities([...answers('a',9,0),...answers(null,20,0,100),...answers('b',10,9,200)],[freq('a',20),freq('b',30)]),[]);
});
