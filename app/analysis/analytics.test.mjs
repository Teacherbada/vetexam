import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('./analytics.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { buildAnalysis, getMasteryStatus, practiceHref, subjectPalette } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const [pathology, pharmacology, diagnostic] = Object.keys(subjectPalette);
const record = (count, correct) => ({ answered: Array.from({ length: count }, (_, i) => i + 1), correct, wrong: count - correct });

test('empty records have no score or recommendation, while preserving six established subjects', () => {
  const result = buildAnalysis('{}');
  assert.equal(result.accuracy, null);
  assert.equal(result.ranking.length, 0);
  assert.equal(result.subjects.length, 6);
  assert.ok(result.subjects.every(s => s.accuracy === null));
});
test('overall accuracy is weighted by answered questions, not averaged across subjects', () => {
  const result = buildAnalysis(JSON.stringify({ [pathology]: record(10, 0), [pharmacology]: record(90, 90) }));
  assert.equal(result.accuracy, 90);
  assert.equal(result.answered, 100);
  assert.equal(result.correct, 90);
  assert.equal(result.wrong, 10);
});
test('fewer than ten answers never establishes mastery or enters weakest ranking', () => {
  const result = buildAnalysis(JSON.stringify({ [pathology]: record(9, 0), [pharmacology]: record(10, 6) }));
  assert.equal(getMasteryStatus(100, 9), '資料不足');
  assert.equal(result.ranking.length, 1);
  assert.equal(result.ranking[0].subject, pharmacology);
});
test('ranks by unrounded score and preserves subject colors across scores', () => {
  const result = buildAnalysis(JSON.stringify({ [pathology]: record(1000, 649), [pharmacology]: record(1000, 651), [diagnostic]: record(10, 2) }));
  assert.deepEqual(result.ranking.map(s => s.subject), [diagnostic, pathology, pharmacology]);
  const differentScore = buildAnalysis(JSON.stringify({ [pathology]: record(10, 10) }));
  assert.deepEqual(result.subjects[0].color, differentScore.subjects[0].color);
});
test('status uses raw thresholds, and legitimate zero accuracy is not an empty state', () => {
  for (const [score, expected] of [[0, '優先複習'], [49.9, '優先複習'], [50, '需要加強'], [64.9, '需要加強'], [65, '穩定'], [79.9, '穩定'], [80, '掌握良好'], [100, '掌握良好']]) assert.equal(getMasteryStatus(score, 10), expected);
  assert.equal(buildAnalysis(JSON.stringify({ [pathology]: record(10, 0) })).accuracy, 0);
});
test('malformed records are excluded without changing the input or fabricating numbers', () => {
  for (const raw of ['null', '[]', '{', 'storage-unavailable']) {
    const result = buildAnalysis(raw);
    assert.equal(result.hasInvalidRecords, true);
    assert.equal(result.accuracy, null);
  }
  const raw = JSON.stringify({ [pathology]: record(20, 10), [pharmacology]: { answered: [1], correct: 5, wrong: 0 }, bad: { answered: [1, 1], correct: 2, wrong: 0 } });
  const result = buildAnalysis(raw);
  assert.equal(result.hasInvalidRecords, true);
  assert.equal(result.answered, 20);
  assert.equal(result.accuracy, 50);
  assert.equal(JSON.parse(raw)[pharmacology].correct, 5);
});
test('existing unknown subjects remain in totals without inventing a practice route', () => {
  const result = buildAnalysis(JSON.stringify({ '歷史科目': record(10, 3) }));
  assert.equal(result.answered, 10);
  assert.equal(result.ranking[0].subject, '歷史科目');
  assert.equal(practiceHref('歷史科目'), '/subjects');
  const url = new URL(practiceHref(pathology), 'http://localhost');
  assert.equal(url.pathname, '/questions');
  assert.equal(url.searchParams.get('subjects'), pathology);
  assert.equal(url.searchParams.get('count'), '20');
  assert.equal(url.searchParams.get('order'), 'random');
});
