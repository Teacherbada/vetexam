import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
function load(path) {
  const exports = {};
  new Function('exports', ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(exports);
  return exports;
}
const { reviewState } = load('app/pdf/import-review.ts');
const { assessQuestion } = load('lib/pdf-layout.ts');
test('automatic pass requires >=90 and no warnings; manual confirmation has its own state', () => {
  assert.equal(reviewState({ confidence: 90, warnings: [] }), 'passed');
  assert.equal(reviewState({ confidence: 89, warnings: [] }), 'needs-review');
  assert.equal(reviewState({ confidence: 95, warnings: ['跨頁'] }), 'needs-review');
  assert.equal(reviewState({ confidence: 69, warnings: [] }), 'anomaly');
  assert.equal(reviewState({ confidence: 70, warnings: ['parser 警告'] }), 'needs-review');
  assert.equal(reviewState({ confidence: 0, warnings: ['缺選項'] }, true), 'reviewed');
});
test('major existing warnings remain obvious anomalies even with a score above 70', () => {
  for (const warning of ['缺選項', '題號不合法', '題幹長度異常', '答案不在選項內']) assert.equal(reviewState({ confidence: 75, warnings: [warning] }), 'anomaly');
});
test('existing assessment drives missing answers and repaired content without changing parser scoring', () => {
  const q = { questionNumber: 1, question: '請選擇正確敘述', options: ['甲', '乙', '丙', '丁', '戊'], answer: '', warnings: [] };
  assert.equal(reviewState(assessQuestion(q)), 'needs-review');
  assert.equal(reviewState(assessQuestion({ ...q, answer: 'E' })), 'passed');
  assert.equal(reviewState(assessQuestion({ ...q, answer: 'E', options: ['甲', '乙', '丙', '丁'] })), 'anomaly');
});
