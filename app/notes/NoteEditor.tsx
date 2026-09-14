"use client";
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EXAM_SUBJECTS, chapterGroups, validChapter } from '@/data/exam-chapters';
import { NOTE_TITLE_MAX_LENGTH, NOTE_CONTENT_MAX_LENGTH, parseNote, type NoteInput, type NoteView } from '@/lib/notes';
import styles from './notes.module.css';
export default function NoteEditor({ id, subject = '', chapter = '' }: { id?: string; subject?: string; chapter?: string }) {
  const router = useRouter(), lock = useRef(false);
  const [value, setValue] = useState<NoteInput>({ type: 'community', title: '', content: '', subject: EXAM_SUBJECTS.includes(subject) ? subject : '', chapter: validChapter(subject, chapter) ? chapter : '', visibility: 'private', status: 'active' });
  const [ready, setReady] = useState(false), [admin, setAdmin] = useState(false), [guest, setGuest] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { const controller = new AbortController();
    fetch(id ? `/api/notes/${encodeURIComponent(id)}` : '/api/notes?tab=mine', { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (response.status === 401) { setGuest(true); return; }
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      if (!body.signedIn) { setGuest(true); return; }
      if (id) { const note: NoteView = body.note; if (!note.canEdit) throw new Error('你沒有編輯這篇筆記的權限。'); setValue({ type: note.type, title: note.title, content: note.content, subject: note.subject, chapter: note.chapter, visibility: note.visibility, status: note.status }); }
      if (!controller.signal.aborted) { setAdmin(body.admin); setReady(true); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [id]);
  async function save(remove = false) {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(id ? `/api/notes/${id}` : '/api/notes', { method: remove ? 'DELETE' : id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, ...(remove ? {} : { body: JSON.stringify(value) }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      router.push(remove ? '/notes?tab=mine' : `/notes/${body.note.id}`); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '儲存未確認，請重試。'); }
    finally { lock.current = false; setBusy(false); }
  }
  if (guest) return <section className={`study-card ${styles.stack}`}><p>登入後即可新增與管理自己的筆記。</p><Link href="/login" className="study-button">登入帳號</Link></section>;
  return <section className={`study-card ${styles.stack}`}>{error && <p role="alert">{error}</p>}{!ready ? !error && <p role="status">準備編輯器中…</p> : <form className={styles.stack} onSubmit={event => { event.preventDefault(); if (parseNote(value)) void save(); }}>
    <p className="study-muted">用文字整理你的重點，換行會保留。</p>
    {admin && !id && <label className={styles.field}>筆記類型<select aria-label="筆記類型" disabled={busy} value={value.type} onChange={event => setValue({ ...value, type: event.target.value as NoteInput['type'], visibility: event.target.value === 'official' ? 'public' : 'private', status: event.target.value === 'official' ? 'draft' : 'active' })}><option value="community">社群筆記</option><option value="official">VetExam 官方筆記</option></select></label>}
    <label className={styles.field}>標題<input aria-label="標題" required maxLength={NOTE_TITLE_MAX_LENGTH} disabled={busy} value={value.title} onChange={event => setValue({ ...value, title: event.target.value })} /><span className="study-muted">{value.title.length} / {NOTE_TITLE_MAX_LENGTH}</span></label>
    <div className={styles.filters}><label className={styles.field}>科目<select aria-label="科目" required disabled={busy} value={value.subject} onChange={event => setValue({ ...value, subject: event.target.value, chapter: '' })}><option value="">請選擇科目</option>{EXAM_SUBJECTS.map(item => <option key={item}>{item}</option>)}</select></label><label className={styles.field}>主要章節<select aria-label="主要章節" required disabled={busy || !value.subject} value={value.chapter} onChange={event => setValue({ ...value, chapter: event.target.value })}><option value="">請選擇章節</option>{chapterGroups(value.subject).flatMap(group => group.chapters).map(item => <option key={item}>{item}</option>)}</select></label></div>
    <label className={styles.field}>內容<textarea aria-label="內容" required maxLength={NOTE_CONTENT_MAX_LENGTH} disabled={busy} value={value.content} onChange={event => setValue({ ...value, content: event.target.value })} /><span className="study-muted">{value.content.length} / {NOTE_CONTENT_MAX_LENGTH}</span></label>
    {value.type === 'official' ? <label className={styles.field}>發布狀態<select aria-label="發布狀態" disabled={busy} value={value.status} onChange={event => setValue({ ...value, status: event.target.value as NoteInput['status'] })}><option value="draft">草稿（僅管理員）</option><option value="published">公開發布</option></select></label> : <><label className={styles.field}>公開設定<select aria-label="公開設定" disabled={busy} value={value.visibility} onChange={event => setValue({ ...value, visibility: event.target.value as NoteInput['visibility'] })}><option value="private">私人（只有自己）</option><option value="public">公開分享</option></select></label>{value.status === 'hidden' && <label><input type="checkbox" onChange={event => { if (event.target.checked) setValue({ ...value, status: 'active' }); }} />恢復顯示</label>}</>}
    <div className={styles.actions}><button className="study-button study-button-primary" disabled={busy || !parseNote(value)} type="submit">{busy ? '儲存中…' : '儲存筆記'}</button>{id && <button type="button" className="study-button" disabled={busy} onClick={() => setConfirmDelete(true)}>刪除筆記</button>}</div>
    {confirmDelete && <div className={styles.stack}><p>確定刪除這篇筆記？刪除後將不再顯示於列表及收藏。</p><div className={styles.actions}><button type="button" className="study-button" disabled={busy} onClick={() => void save(true)}>確認刪除</button><button type="button" className="study-button" disabled={busy} onClick={() => setConfirmDelete(false)}>取消</button></div></div>}
  </form>}</section>;
}
