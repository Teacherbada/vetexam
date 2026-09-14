import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TEST_BASE_URL || 'http://localhost:3145';
mkdirSync('.tmp/notes-artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  let actor = 'alice'; const notes = [], queries = [];
  const subject = '獸醫病理學', chapter = '腫瘤';
  const isPublic = n => !n.deleted && n.visibility === 'public' && ['active','published'].includes(n.status);
  const canRead = n => !n.deleted && (isPublic(n) || n.type === 'official' && actor === 'admin' || n.type === 'community' && n.author === actor);
  const view = n => ({ ...n, canEdit: n.type === 'official' ? actor === 'admin' : actor === n.author, authorName: n.author === 'admin' ? 'VetExam' : '測試作者', canReact: isPublic(n), isHelpful: n.helpfulUsers.includes(actor), isFavorite: n.favorites.includes(actor), helpful: n.helpfulUsers.length });
  await page.route('**/api/notes**', async route => {
    const request = route.request(), url = new URL(request.url()), id = url.pathname.split('/')[3], body = request.method() === 'GET' || request.method() === 'DELETE' ? {} : request.postDataJSON();
    let note = notes.find(n => n.id === id);
    if (request.method() === 'POST') { note = { ...body, id: `00000000-0000-4000-8000-${String(notes.length + 1).padStart(12,'0')}`, author: actor, helpfulUsers: [], favorites: [], createdAt: '2026-09-14T00:00:00Z', updatedAt: '2026-09-14T00:00:00Z' }; notes.push(note); }
    if (request.method() === 'PUT') Object.assign(note, body);
    if (request.method() === 'DELETE') { note.deleted = true; return route.fulfill({ json: { deleted: true } }); }
    if (request.method() === 'PATCH') { const key = body.kind === 'helpful' ? 'helpfulUsers' : 'favorites'; note[key] = note[key].filter(value => value !== actor); if (body.active) note[key].push(actor); }
    if (note) return canRead(note) ? route.fulfill({ json: { note: view(note), signedIn: actor !== 'guest', admin: actor === 'admin' } }) : route.fulfill({ status: 404, json: { error: '找不到可閱讀的筆記。' } });
    queries.push(url.searchParams);
    const tab = url.searchParams.get('tab') || 'all';
    let selected = notes.filter(canRead).filter(n => (!url.searchParams.get('subject') || n.subject === url.searchParams.get('subject')) && (!url.searchParams.get('chapter') || n.chapter === url.searchParams.get('chapter')));
    selected = selected.filter(n => tab === 'mine' ? n.author === actor || actor === 'admin' && n.type === 'official' : tab === 'favorites' ? n.favorites.includes(actor) : isPublic(n) && (tab === 'all' || n.type === tab));
    selected.sort((a,b) => Number(b.type === 'official') - Number(a.type === 'official') || b.helpfulUsers.length - a.helpfulUsers.length);
    return route.fulfill({ json: { notes: selected.map(view), page: 1, hasMore: false, signedIn: actor !== 'guest', admin: actor === 'admin' } });
  });
  await page.goto(base + '/notes/new'); await page.getByLabel('標題', { exact: false }).fill('腫瘤重點整理'); await page.getByLabel('科目', { exact: true }).selectOption(subject); await page.getByLabel('主要章節', { exact: true }).selectOption(chapter);
  const xss = '<img src=x onerror="window.noteXss=1">\n<script>window.noteXss=1</script>\n第一行重點\n第二行重點';
  await page.getByLabel('內容', { exact: false }).fill(xss);
  assert.equal(await page.locator('input[type=file]').count(), 0);
  for (const width of [320,375,768,1280]) { await page.setViewportSize({ width, height: 900 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'editor overflow ' + width); }
  await page.setViewportSize({ width: 375, height: 900 }); await page.screenshot({ path: '.tmp/notes-artifacts/editor.png', fullPage: true });
  await page.getByRole('button', { name: '儲存筆記', exact: true }).click(); await page.getByRole('heading', { name: '腫瘤重點整理', exact: true }).waitFor();
  const communityId = notes[0].id; assert.equal(notes[0].visibility, 'private'); assert.equal(await page.evaluate(() => window.noteXss), undefined); assert.equal(await page.locator('article img').count(), 0); await page.getByText('私人', { exact: true }).waitFor();
  await page.getByRole('link', { name: '編輯筆記', exact: true }).click(); await page.getByLabel('公開設定', { exact: true }).selectOption('public'); await page.getByRole('button', { name: '儲存筆記', exact: true }).click(); await page.getByRole('button', { name: '☆ 收藏', exact: true }).waitFor();
  actor = 'bob'; await page.reload(); await page.getByRole('button', { name: '有幫助 0', exact: true }).click(); await page.getByRole('button', { name: '已標記有幫助 1', exact: true }).waitFor();
  await page.getByRole('button', { name: '☆ 收藏', exact: true }).click(); await page.getByRole('button', { name: '★ 已收藏', exact: true }).waitFor();
  await page.reload(); await page.getByRole('button', { name: '★ 已收藏', exact: true }).waitFor(); assert.equal(notes[0].favorites.length, 1);
  await page.getByRole('button', { name: '已標記有幫助 1', exact: true }).click(); await page.getByRole('button', { name: '有幫助 0', exact: true }).waitFor();
  await page.goto(base + '/notes?tab=favorites'); await page.getByRole('heading', { name: '腫瘤重點整理', exact: true }).waitFor();
  actor = 'admin'; await page.goto(base + '/notes/new'); await page.getByLabel('筆記類型', { exact: true }).selectOption('official'); await page.getByLabel('標題', { exact: false }).fill('官方腫瘤筆記'); await page.getByLabel('科目', { exact: true }).selectOption(subject); await page.getByLabel('主要章節', { exact: true }).selectOption(chapter); await page.getByLabel('內容', { exact: false }).fill('官方文字重點'); await page.getByRole('button', { name: '儲存筆記', exact: true }).click(); await page.getByText('草稿', { exact: true }).waitFor();
  await page.getByRole('link', { name: '編輯筆記', exact: true }).click(); await page.getByLabel('發布狀態', { exact: true }).selectOption('published'); await page.getByRole('button', { name: '儲存筆記', exact: true }).click(); await page.getByRole('heading', { name: '官方腫瘤筆記', exact: true }).waitFor();
  actor = 'bob'; await page.goto(base + '/notes'); await page.getByRole('heading', { name: '官方腫瘤筆記', exact: true }).waitFor(); assert.equal(await page.locator('article h2').first().innerText(), '官方腫瘤筆記');
  await page.getByLabel('科目', { exact: true }).selectOption(subject); await page.getByLabel('章節', { exact: true }).selectOption(chapter); await page.getByLabel('社群排序', { exact: true }).selectOption('helpful'); await page.waitForURL(/sort=helpful/);
  assert.equal(new URL(page.url()).searchParams.get('chapter'), chapter, 'changing sort preserves the selected chapter');
  for (const width of [320,375,768,1280]) { await page.setViewportSize({ width, height: 900 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'list overflow ' + width); }
  await page.setViewportSize({ width: 375, height: 900 }); await page.screenshot({ path: '.tmp/notes-artifacts/list.png', fullPage: true });
  const source = { subject, chapter, correct: 1, count: 5, accuracy: .2, status: 'strengthen' };
  const reinforcement = { mode: 'coach', task: { id: 'task', ...source, source_analysis: source, status: 'reviewing', review_count: 1 }, next: null, session: null, attempts: [], completed: [], due: [] };
  await page.route('**/api/study-plan/reinforcement', route => { if (route.request().method() === 'PATCH') reinforcement.task.status = 'reviewed'; return route.fulfill({ json: reinforcement }); });
  await page.goto(base + '/study-plan/reinforcement'); await page.getByRole('heading', { name: 'VetExam 官方筆記', exact: true }).waitFor(); await page.getByRole('heading', { name: '社群熱門筆記', exact: true }).waitFor();
  const related = new URL(await page.getByRole('link', { name: '查看相關筆記', exact: true }).getAttribute('href'), base); assert.equal(related.searchParams.get('subject'), subject); assert.equal(related.searchParams.get('chapter'), chapter);
  assert(queries.some(p => p.get('tab') === 'community' && p.get('chapter') === chapter && p.get('sort') === 'helpful'));
  await page.getByRole('button', { name: '我已完成複習', exact: true }).click(); await page.getByRole('button', { name: '開始確認', exact: true }).waitFor();
  actor = 'alice'; await page.goto(base + `/notes/${communityId}/edit`); await page.getByLabel('公開設定', { exact: true }).selectOption('private'); await page.getByRole('button', { name: '儲存筆記', exact: true }).click(); await page.getByText('私人', { exact: true }).waitFor();
  actor = 'bob'; await page.reload(); await page.getByText('找不到可閱讀的筆記。', { exact: true }).waitFor(); await page.goto(base + '/notes?tab=favorites'); await page.getByText('還沒有可閱讀的收藏筆記。', { exact: true }).waitFor();
  actor = 'alice'; await page.goto(base + `/notes/${communityId}/edit`); await page.getByRole('button', { name: '刪除筆記', exact: true }).click(); await page.getByRole('button', { name: '確認刪除', exact: true }).click(); await page.getByText('你還沒有筆記。', { exact: true }).waitFor();
  assert.deepEqual(errors, []); console.log('PASS notes editor/private/public/official draft-publish/XSS/plain text/filters/favorites/helpful/privacy change/delete/related notes/self review/four widths');
} finally { await browser.close(); }
