import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync(new URL('../lib/question-state.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {stateSelection,legacyAnsweredIds}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('states include and exclude the right IDs, with empty filters producing no matches',()=>{
  const data={answered:[1,2,2],wrong:[2],favorites:[]};
  assert.equal(stateSelection('all',data),null);
  assert.deepEqual(stateSelection('unanswered',data),{ids:[1,2],exclude:true});
  assert.deepEqual(stateSelection('wrong',data),{ids:[2],exclude:false});
  assert.deepEqual(stateSelection('favorites',data),{ids:[],exclude:false});
});
test('archived answered IDs remain known without fabricating individual correctness',()=>{
  assert.deepEqual(legacyAnsweredIds([{progress:{s:{answered:[1,1,2,-1,'3',null]}}},{progress:null},{progress:{s:{answered:[4]}}}]),[1,2,4]);
});
