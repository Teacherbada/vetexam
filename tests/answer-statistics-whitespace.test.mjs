import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { loadMemoryModule as load, memoryService } from './memory-test-loader.mjs';

const stats = load('lib/question-stats.ts');
const learning = load('lib/learning-service.ts', {
  './question-stats': stats, './question-state': load('lib/question-state.ts'), './question-memory-service': memoryService,
});

test('answer submission format remains one A-E letter', () => {
  for (const selected_answer of ['F', 'AB', ' A ', '', '\u00a0']) {
    assert.equal(stats.parseAnswerSubmissions({ answers: [{ question_id: 1, selected_answer }] }), null);
  }
  assert.deepEqual(stats.parseAnswerSubmissions({ answers: [{ question_id: 1, selected_answer: 'e' }] }), [{ question_id: 1, selected_answer: 'E' }]);
});

test('PostgreSQL: both writers trim Unicode keys/options and preserve privacy and idempotency', { skip: process.env.PRACTICE_DB_TEST !== '1' }, async () => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query('CREATE TEMP TABLE question_sets(id integer PRIMARY KEY, visibility text)');
    await db.query('CREATE TEMP TABLE questions(id integer PRIMARY KEY, question_set_id integer, answer text, option_a text, option_b text, option_c text, option_d text, option_e text)');
    await db.query('CREATE TEMP TABLE question_answer_stats(id bigserial, user_id text, question_id integer, is_correct boolean, selected_answer text, UNIQUE(user_id,question_id))');
    await db.query('CREATE TEMP TABLE practice_attempts(user_id text, event_id uuid, question_id integer, selected_answer text, is_correct boolean, mode text, answered_at timestamptz, UNIQUE(user_id,event_id))');
    await db.query(`CREATE TEMP TABLE question_memory_state(user_id text, question_id integer, due timestamptz,
      stability float8, difficulty float8, elapsed_days integer, scheduled_days integer, learning_steps integer,
      reps integer, lapses integer, state smallint, last_review timestamptz, updated_at timestamptz DEFAULT clock_timestamp(), PRIMARY KEY(user_id,question_id))`);
    await db.query("INSERT INTO question_sets VALUES (1,'public'),(2,'private')");
    const fixtures = [
      [1, 1, '\t a \u3000', 'a', 'b', 'e', 'A'],
      [2, 1, '\ufeffE\u00a0', 'a', 'b', 'e', 'E'],
      [3, 1, 'A', '\u00a0', 'b', 'e', 'B'], // Blank correct option.
      [4, 1, 'A', 'a', '\t\u202f', 'e', 'B'], // Blank selected option.
      [5, 2, 'A', 'a', 'b', 'e', 'A'], // Private question.
      [6, 1, 'F', 'a', 'b', 'e', 'A'],
      [7, 1, '\u2007A\u2007', 'a', 'b', 'e', 'B'], // Valid incorrect attempt.
      [8, 1, 'E', 'a', 'b', '\ufeff', 'A'],
      [9, 1, '\t\u00a0', 'a', 'b', 'e', 'A'],
      [10, 1, 'AB', 'a', 'b', 'e', 'A'],
      [11, 1, 'A', null, 'b', 'e', 'B'],
    ];
    for (const [id, set, answer, a, b, e] of fixtures) {
      await db.query("INSERT INTO questions VALUES ($1,$2,$3,$4,$5,'c','d',$6)", [id, set, answer, a, b, e]);
    }
    const originals = (await db.query('SELECT * FROM questions ORDER BY id')).rows;
    const answers = fixtures.map(([question_id, , , , , , selected_answer]) => ({ question_id, selected_answer, event_id: randomUUID() }));
    const query = async (text, values) => (await db.query(text, values)).rows;
    await stats.recordFirstAnswers(query, 'first', answers);
    const first = (await db.query("SELECT question_id,is_correct,selected_answer FROM question_answer_stats WHERE user_id='first' ORDER BY question_id")).rows;
    assert.deepEqual(first, [
      { question_id: 1, is_correct: true, selected_answer: 'A' },
      { question_id: 2, is_correct: true, selected_answer: 'E' },
      { question_id: 7, is_correct: false, selected_answer: 'B' },
    ]);
    await stats.recordFirstAnswers(query, 'first', [{ question_id: 7, selected_answer: 'A' }]);
    assert.deepEqual((await db.query("SELECT question_id,is_correct,selected_answer FROM question_answer_stats WHERE user_id='first' ORDER BY question_id")).rows, first);

    await learning.recordPractice(db, 'practice', answers, 'practice');
    const practice = (await db.query("SELECT question_id,is_correct,selected_answer FROM practice_attempts WHERE user_id='practice' ORDER BY question_id")).rows;
    assert.deepEqual(practice, first);
    const memoryBeforeRetry = (await db.query("SELECT * FROM question_memory_state WHERE user_id='practice' ORDER BY question_id")).rows;
    await learning.recordPractice(db, 'practice', answers, 'practice');
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM practice_attempts')).rows[0].count, 3);
    assert.deepEqual((await db.query("SELECT * FROM question_memory_state WHERE user_id='practice' ORDER BY question_id")).rows, memoryBeforeRetry);
    await learning.recordPractice(db, 'practice', [{ question_id: 7, selected_answer: 'A', event_id: randomUUID() }], 'exam');
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM practice_attempts')).rows[0].count, 4);
    assert.equal((await db.query("SELECT reps FROM question_memory_state WHERE user_id='practice' AND question_id=7")).rows[0].reps, 2);
    assert.deepEqual((await db.query("SELECT question_id,is_correct,selected_answer FROM question_answer_stats WHERE user_id='practice' ORDER BY question_id")).rows, first);
    assert.deepEqual((await db.query('SELECT * FROM questions ORDER BY id')).rows, originals, 'validation does not rewrite source questions');
  } finally { await db.query('ROLLBACK'); await db.end(); }
});
