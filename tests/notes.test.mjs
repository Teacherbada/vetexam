import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import ts from 'typescript';
import nextEnv from '@next/env';
import pg from 'pg';
import { diagnosticTestConnectionString } from './diagnostic-database.mjs';
function load(path, mocks = {}) {
  const exports = {}; new Function('require','exports', ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(name => { if (name === 'server-only') return {}; if (Object.hasOwn(mocks, name)) return mocks[name]; throw new Error('Unexpected import ' + name); }, exports); return exports;
}
const chapters = load('data/exam-chapters.ts'), rules = load('lib/notes.ts', { '../data/exam-chapters': chapters });
const service = load('lib/notes-service.ts', { 'node:crypto': { randomUUID }, '@/lib/notes': rules });
const subject = chapters.EXAM_SUBJECTS[0], chapter = chapters.chapterGroups(subject)[0].chapters[0];
const input = { type: 'community', title: 'Title', content: 'Plain text\n<script>window.bad=1</script>', subject, chapter, visibility: 'private', status: 'active' };
const filters = { subject: '', chapter: '', tab: 'all', sort: 'latest', page: 1 };
test('notes validate official taxonomy, centralized bounds, plain text and reject attachments/identity', () => {
  assert.deepEqual(rules.parseNote(input), input);
  for (const patch of [{ title: '' }, { title: 'x'.repeat(rules.NOTE_TITLE_MAX_LENGTH + 1) }, { content: 'x'.repeat(rules.NOTE_CONTENT_MAX_LENGTH + 1) }, { content: 'data:image/png;base64,abcd' }, { subject: 'fake' }, { chapter: 'fake' }, { chapter: '' }, { chapter: null }, { author_id: 'other' }, { image: 'upload' }, { type: 'official' }, { status: 'published' }]) assert.equal(rules.parseNote({ ...input, ...patch }), null);
  assert(rules.parseNote({ ...input, type: 'official', visibility: 'public', status: 'draft' }));
  for (const query of ['subject=fake','chapter=fake','sort=sql','tab=admin','page=0','page=10001']) assert.equal(rules.parseNoteFilters(new URLSearchParams(query)), null);
  const href = rules.relatedNotesHref(subject, chapter); const p = new URL(href, 'https://test.local').searchParams; assert.equal(p.get('subject'), subject); assert.equal(p.get('chapter'), chapter); assert.equal(p.get('sort'), 'helpful');
});
test('notes HTTP authenticates writes and defends origin, identity, media and oversized payloads', async () => {
  const api = userId => load('lib/notes-http.ts', { 'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } }, '@/lib/auth': { auth: { api: { getSession: async () => userId ? { user: { id: userId } } : null } } }, '@/lib/question-transaction': { questionTransaction: () => { throw new Error('database-secret'); } }, '@/lib/notes': rules, '@/lib/notes-service': service }).notesHttp;
  const url = 'https://test.local/api/notes', id = randomUUID();
  for (const method of ['POST','PUT','PATCH','DELETE']) assert.equal((await api(null)(new Request(url, { method }), method === 'POST' ? undefined : id)).status, 401);
  for (const method of ['POST','PUT','PATCH','DELETE']) assert.equal((await api('alice')(new Request(url, { method, headers: { origin: 'https://evil.local' } }), id)).status, 403);
  for (const [body, status] of [['{',400],['x'.repeat(rules.NOTE_BODY_MAX_BYTES + 1),413],[JSON.stringify({ ...input, author_id: 'bob' }),400]]) assert.equal((await api('alice')(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }))).status, status);
  assert.equal((await api('alice')(new Request(url, { method: 'POST', headers: { 'Content-Type': 'multipart/form-data' }, body: 'file' }))).status, 415);
  assert.equal((await api(null)(new Request(url), 'invalid')).status, 404);
  const failed = await api(null)(new Request(url)); assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /database-secret/);
});
test('PostgreSQL notes privacy, official permissions, ownership, reactions, favorites, sorting and soft delete', { skip: process.env.NOTES_DB_TEST !== '1', timeout: 180000 }, async () => {
  nextEnv.loadEnvConfig(process.cwd()); const client = new pg.Client({ connectionString: diagnosticTestConnectionString(), connectionTimeoutMillis: 10000 }); await client.connect();
  const alice = { id: 'alice-internal', admin: false }, bob = { id: 'bob-internal', admin: false }, admin = { id: 'admin-internal', admin: true }, guest = { id: null, admin: false };
  try {
    await client.query('BEGIN'); await client.query('CREATE TEMP TABLE "user"(id text PRIMARY KEY,name text,email text)');
    await client.query('INSERT INTO "user" VALUES($1,$2,$3),($4,$5,$6),($7,$8,$9)', [alice.id,'Alice','alice@example.test',bob.id,'Bob','bob@example.test',admin.id,'VetExam','admin@example.test']);
    const migration = readFileSync(new URL('../migrations/20260920_notes.sql', import.meta.url), 'utf8').replaceAll('CREATE TABLE IF NOT EXISTS','CREATE TEMP TABLE IF NOT EXISTS'); await client.query(migration); await client.query(migration);
    const privateNote = (await service.saveNote(client, alice, input)).note;
    for (const actor of [bob, admin, guest]) await assert.rejects(service.readNote(client, actor, privateNote.id), e => e.status === 404);
    await assert.rejects(service.saveNote(client, bob, input, privateNote.id), e => e.status === 404);
    await assert.rejects(service.deleteNote(client, bob, privateNote.id), e => e.status === 404);
    assert.equal((await service.listNotes(client, alice, { ...filters, tab: 'mine' })).notes.length, 1);
    assert.equal((await service.listNotes(client, bob, filters)).notes.length, 0);
    await assert.rejects(service.listNotes(client, guest, { ...filters, tab: 'favorites' }), e => e.status === 401);
    const publicNote = (await service.saveNote(client, alice, { ...input, visibility: 'public' }, privateNote.id)).note;
    const publicRead = await service.readNote(client, guest, publicNote.id); assert.equal(publicRead.note.canEdit, false); assert.equal(publicRead.note.authorName, 'Alice');
    assert.doesNotMatch(JSON.stringify(publicRead), /alice-internal|alice@example|author_id|email/);
    const official = { ...input, type: 'official', visibility: 'public', status: 'draft' };
    await assert.rejects(service.saveNote(client, alice, official), e => e.status === 403);
    let draft = (await service.saveNote(client, admin, official)).note;
    for (const actor of [alice, guest]) await assert.rejects(service.readNote(client, actor, draft.id), e => e.status === 404);
    assert.equal((await service.listNotes(client, admin, { ...filters, tab: 'mine' })).notes[0].status, 'draft');
    draft = (await service.saveNote(client, admin, { ...official, status: 'published' }, draft.id)).note;
    assert.equal((await service.readNote(client, guest, draft.id)).note.type, 'official');
    await assert.rejects(service.saveNote(client, alice, { ...input, visibility: 'public' }, draft.id), e => e.status === 404);
    for (const kind of ['helpful','favorite']) { await service.reactToNote(client, bob, publicNote.id, kind, true); await service.reactToNote(client, bob, publicNote.id, kind, true); }
    assert.equal((await service.readNote(client, bob, publicNote.id)).note.helpful, 1);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM note_favorites')).rows[0].n, 1);
    assert.equal((await service.listNotes(client, bob, { ...filters, tab: 'favorites' })).notes.length, 1);
    const second = (await service.saveNote(client, alice, { ...input, title: 'Other chapter', chapter: chapters.chapterGroups(subject)[0].chapters[1], visibility: 'public' })).note;
    let list = await service.listNotes(client, guest, { ...filters, sort: 'helpful' }); assert.equal(list.notes[0].id, draft.id); assert.equal(list.notes[1].id, publicNote.id);
    list = await service.listNotes(client, guest, { ...filters, subject, chapter }); assert(!list.notes.some(row => row.id === second.id)); assert.equal(list.notes.length, 2);
    await client.query('COMMIT'); await client.query('BEGIN');
    assert.equal((await service.readNote(client, bob, publicNote.id)).note.isHelpful, true);
    for (const kind of ['helpful','favorite']) { await service.reactToNote(client, bob, publicNote.id, kind, false); await service.reactToNote(client, bob, publicNote.id, kind, false); }
    assert.equal((await service.readNote(client, bob, publicNote.id)).note.helpful, 0);
    await service.reactToNote(client, bob, publicNote.id, 'favorite', true);
    await service.saveNote(client, alice, input, publicNote.id);
    assert.equal((await service.listNotes(client, bob, { ...filters, tab: 'favorites' })).notes.length, 0);
    await assert.rejects(service.readNote(client, bob, publicNote.id), e => e.status === 404);
    await assert.rejects(service.reactToNote(client, bob, publicNote.id, 'helpful', true), e => e.status === 404);
    await service.reactToNote(client, bob, draft.id, 'favorite', true);
    await service.saveNote(client, admin, official, draft.id);
    await assert.rejects(service.readNote(client, bob, draft.id), e => e.status === 404);
    assert.equal((await service.listNotes(client, bob, { ...filters, tab: 'favorites' })).notes.length, 0);
    await service.saveNote(client, alice, { ...input, visibility: 'public', status: 'hidden' }, second.id);
    await assert.rejects(service.readNote(client, guest, second.id), e => e.status === 404);
    await service.deleteNote(client, alice, publicNote.id); await service.deleteNote(client, alice, publicNote.id);
    await assert.rejects(service.readNote(client, alice, publicNote.id), e => e.status === 404);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM note_favorites WHERE note_id=$1', [publicNote.id])).rows[0].n, 1, 'soft delete retains relation safely');
    assert.equal((await service.listNotes(client, guest, filters)).notes.length, 0);
    await client.query("INSERT INTO notes(id,author_id,type,title,content,subject,chapter,visibility,status) SELECT md5(n::text)::uuid,$1,'community','Page '||n,'text',$2,$3,'public','active' FROM generate_series(1,21) n", [alice.id, subject, chapter]);
    const first = await service.listNotes(client, guest, filters), next = await service.listNotes(client, guest, { ...filters, page: 2 });
    assert.equal(first.notes.length, rules.NOTE_PAGE_SIZE); assert(first.hasMore); assert.equal(next.notes.length, 1); assert(!first.notes.some(row => row.id === next.notes[0].id));
  } finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
});
