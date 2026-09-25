import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
export function loadMemoryModule(path, mocks = {}) {
  const exports = {};
  new Function('require','exports',ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'), {
    compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 },
  }).outputText)(name => {
    if (name === 'server-only') return {};
    if (Object.hasOwn(mocks,name)) return mocks[name];
    if (name === 'ts-fsrs') return require(name);
    throw new Error('Unexpected import '+name);
  }, exports);
  return exports;
}
export const memoryService = loadMemoryModule('lib/question-memory-service.ts');
