import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
function load(path, mocks = {}) {
  const exports = {};
  new Function('require', 'exports', ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(name => { if (name in mocks) return mocks[name]; throw Error(name); }, exports);
  return exports;
}
const { quizProgress } = load('lib/quiz-progress.ts', { './question-answer': load('lib/question-answer.ts') });
const questions = [
  { id: 1, answer: 'A', options: ['a', 'b'] },
  { id: 2, answer: 'B', options: ['a', 'b'] },
  { id: 3, answer: '', options: ['a', 'b'] },
];
test('attempted, scored, pending and unanswered are distinct without changing records', () => {
  const answers = { 1: 'A', 3: 'B', 99: 'A' };
  const original = JSON.stringify({ questions, answers });
  assert.deepEqual(quizProgress(questions, answers), { attempted: 2, scored: 1, gradable: 2, pending: 1, unanswered: 1 });
  assert.equal(JSON.stringify({ questions, answers }), original);
  assert.deepEqual(quizProgress([], {}), { attempted: 0, scored: 0, gradable: 0, pending: 0, unanswered: 0 });
  assert.deepEqual(quizProgress([questions[2]], {}), { attempted: 0, scored: 0, gradable: 0, pending: 1, unanswered: 0 });
  assert.deepEqual(quizProgress(questions.slice(0, 2), { 1: 'B', 2: 'B' }), { attempted: 2, scored: 2, gradable: 2, pending: 0, unanswered: 0 });
});
test('pending direct questions remain navigable and practice pairs correct count with scored answers', () => {
  const page = readFileSync(new URL('../app/questions/page.tsx', import.meta.url), 'utf8');
  assert(page.includes('showResult || !currentAnswer'));
  assert(page.includes('答對 ${score} / ${progress.scored} 題'));
  assert(page.includes('if (!usableAnswer(currentQuestion) || submitted.current'));
  const home = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert(home.includes('此處只統計有效計分的作答；答案待核對的題目不計入。'));
});
