import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
function load(path,imports={}) {const exports={};new Function('require','exports',ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>imports[name],exports);return exports;}
const chapters=load('data/exam-chapters.ts'),{chapterFrequency}=load('lib/chapter-frequency.ts',{'../data/exam-chapters':chapters});
const subject=Object.keys(chapters.EXAM_CHAPTERS)[0], [a,b]=chapters.EXAM_CHAPTERS[subject][0].chapters;
const row=(paper,year,chapter,count=1)=>({subject,paper,year,chapter,count});
test('ROC and western years share a window; zero chapter papers remain in denominator',()=>{
  const input=[row(1,115,a,3),row(1,115,b,1),row(2,2022,null,2),row(3,110,a,7),row(4,105,a,9),row(5,null,a,2)];
  const five=chapterFrequency(input,5),ten=chapterFrequency(input,10),all=chapterFrequency(input,null);
  assert.equal(five.latestYear,2026);assert.equal(five.unclassified,2);
  assert.equal(five.rows.find(r=>r.chapter===a).count,3);assert.equal(five.rows.find(r=>r.chapter===a).average,1.5);
  assert.equal(five.rows.find(r=>r.chapter===b).count,1);
  assert.equal(ten.rows.find(r=>r.chapter===a).count,10);assert.equal(all.rows.find(r=>r.chapter===a).count,21);
});
test('empty data and unofficial chapters do not invent official categories',()=>{
  assert.equal(chapterFrequency([],5).rows[0].average,null);
  const result=chapterFrequency([row(1,115,'invented')],5);assert.equal(result.unclassified,1);assert.ok(result.rows.every(r=>r.count===0));
});
