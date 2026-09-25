import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync(new URL('../lib/question-difficulty.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {questionDifficulty}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('insufficient samples hide rates and difficulty; boundaries use unrounded values',()=>{
  for(const count of [0,2,9])assert.equal(questionDifficulty(count,0).rate,null);
  for(const [correct,label] of [[0,'魔王題'],[39,'魔王題'],[40,'困難'],[59,'困難'],[60,'普通'],[79,'普通'],[80,'簡單'],[100,'簡單']])assert.equal(questionDifficulty(100,correct).label,label);
  assert.equal(questionDifficulty(1000,799).label,'普通');
});
