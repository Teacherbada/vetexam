import 'server-only';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { NOTE_PAGE_SIZE, type NoteInput, type NoteView, type NoteFilters } from '@/lib/notes';
export class NoteError extends Error { constructor(public status: number, message: string) { super(message); } }
export type NoteActor = { id: string | null; admin: boolean };
const publicNote = "(n.visibility='public' AND ((n.type='official' AND n.status='published') OR (n.type='community' AND n.status='active')))";
const readable = `(n.deleted_at IS NULL AND (${publicNote} OR (n.type='official' AND $2::boolean) OR (n.type='community' AND n.author_id=$1)))`;
const columns = `n.id,n.type,n.title,n.subject,n.chapter,n.visibility,n.status,n.created_at AS "createdAt",n.updated_at AS "updatedAt",
  COALESCE(NULLIF(BTRIM(u.name),''),'使用者') AS "authorName",
  COALESCE(((n.type='official' AND $2::boolean) OR (n.type='community' AND n.author_id=$1)),FALSE) AS "canEdit",
  (SELECT COUNT(*)::int FROM note_helpful h WHERE h.note_id=n.id) AS helpful,
  EXISTS(SELECT 1 FROM note_helpful h WHERE h.note_id=n.id AND h.user_id=$1) AS "isHelpful",
  EXISTS(SELECT 1 FROM note_favorites f WHERE f.note_id=n.id AND f.user_id=$1) AS "isFavorite",${publicNote} AS "canReact"`;
export async function listNotes(client: PoolClient, actor: NoteActor, filters: NoteFilters) {
  if (['mine','favorites'].includes(filters.tab) && !actor.id) throw new NoteError(401, '請先登入查看你的筆記。');
  const { rows } = await client.query<NoteView>(`SELECT ${columns},LEFT(n.content,200) AS content FROM notes n JOIN "user" u ON u.id=n.author_id
    WHERE ${readable} AND ($3::text='' OR n.subject=$3) AND ($4::text='' OR n.chapter=$4)
    AND (CASE $5 WHEN 'mine' THEN n.author_id=$1 OR (n.type='official' AND $2::boolean)
      WHEN 'favorites' THEN EXISTS(SELECT 1 FROM note_favorites f WHERE f.note_id=n.id AND f.user_id=$1)
      WHEN 'official' THEN n.type='official' AND ${publicNote}
      WHEN 'community' THEN n.type='community' AND ${publicNote} ELSE ${publicNote} END)
    ORDER BY (n.type='official') DESC,CASE WHEN $6='helpful' THEN (SELECT COUNT(*) FROM note_helpful h WHERE h.note_id=n.id) END DESC,n.created_at DESC,n.id DESC
    LIMIT $7 OFFSET $8`, [actor.id, actor.admin, filters.subject, filters.chapter, filters.tab, filters.sort, NOTE_PAGE_SIZE + 1, (filters.page - 1) * NOTE_PAGE_SIZE]);
  return { notes: rows.slice(0, NOTE_PAGE_SIZE), hasMore: rows.length > NOTE_PAGE_SIZE, page: filters.page, signedIn: !!actor.id, admin: actor.admin };
}
export async function readNote(client: PoolClient, actor: NoteActor, id: string) {
  const { rows } = await client.query<NoteView>(`SELECT ${columns},n.content FROM notes n JOIN "user" u ON u.id=n.author_id WHERE n.id=$3 AND ${readable}`, [actor.id, actor.admin, id]);
  if (!rows[0]) throw new NoteError(404, '找不到可閱讀的筆記。');
  return { note: rows[0], signedIn: !!actor.id, admin: actor.admin };
}
export async function saveNote(client: PoolClient, actor: NoteActor, input: NoteInput, id?: string) {
  if (!actor.id) throw new NoteError(401, '請先登入後儲存筆記。');
  if (input.type === 'official' && !actor.admin) throw new NoteError(403, '官方筆記僅限管理員編輯。');
  if (id) {
    const old = (await client.query('SELECT author_id,type FROM notes WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [id])).rows[0];
    if (!old || (old.type === 'official' ? !actor.admin : old.author_id !== actor.id)) throw new NoteError(404, '找不到可編輯的筆記。');
    if (old.type !== input.type) throw new NoteError(400, '筆記類型不能變更。');
    await client.query('UPDATE notes SET title=$2,content=$3,subject=$4,chapter=$5,visibility=$6,status=$7,updated_at=clock_timestamp() WHERE id=$1', [id, input.title, input.content, input.subject, input.chapter, input.visibility, input.status]);
  } else {
    id = randomUUID();
    await client.query('INSERT INTO notes(id,author_id,type,title,content,subject,chapter,visibility,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, actor.id, input.type, input.title, input.content, input.subject, input.chapter, input.visibility, input.status]);
  }
  return readNote(client, actor, id);
}
export async function deleteNote(client: PoolClient, actor: NoteActor, id: string) {
  if (!actor.id) throw new NoteError(401, '請先登入。');
  const result = await client.query("UPDATE notes SET deleted_at=COALESCE(deleted_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND ((type='official' AND $3::boolean) OR (type='community' AND author_id=$2)) RETURNING id", [id, actor.id, actor.admin]);
  if (!result.rows.length) throw new NoteError(404, '找不到可刪除的筆記。');
  return { deleted: true };
}
export async function reactToNote(client: PoolClient, actor: NoteActor, id: string, kind: 'helpful' | 'favorite', active: boolean) {
  if (!actor.id) throw new NoteError(401, '請先登入。');
  // The shared lock prevents a privacy change/delete racing with a reaction.
  const row = (await client.query(`SELECT n.id FROM notes n WHERE n.id=$1 AND n.deleted_at IS NULL AND ${publicNote} FOR SHARE`, [id])).rows[0];
  if (!row) throw new NoteError(404, '找不到可互動的公開筆記。');
  const table = kind === 'helpful' ? 'note_helpful' : 'note_favorites';
  if (active) await client.query(`INSERT INTO ${table}(note_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [id, actor.id]);
  else await client.query(`DELETE FROM ${table} WHERE note_id=$1 AND user_id=$2`, [id, actor.id]);
  return readNote(client, actor, id);
}
