"use client";
import Link from 'next/link';
import { StudyIcon } from '@/components/dashboard/StudyUI';
import { LoadingState } from '@/components/ui/ContentState';
import { useEffect, useRef, useState } from 'react';
import type { NoteView } from '@/lib/notes';
import { NoteBadge, noteDate } from './NoteCard';
import styles from './notes.module.css';
export default function NoteDetail({ id }: { id: string }) {
  const [data, setData] = useState<{ note: NoteView; signedIn: boolean } | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const lock = useRef(false);
  useEffect(() => { const controller = new AbortController();
    fetch(`/api/notes/${encodeURIComponent(id)}`, { cache: 'no-store', signal: controller.signal }).then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error); if (!controller.signal.aborted) setData(body); }).catch(cause => { if (!controller.signal.aborted) { setData(null); setError(cause.message); } });
    return () => controller.abort();
  }, [id, reload]);
  async function react(kind: 'helpful' | 'favorite') {
    if (lock.current || !data) return; lock.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(`/api/notes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, active: !(kind === 'helpful' ? data.note.isHelpful : data.note.isFavorite) }) });
      const body = await response.json(); if (!response.ok) { if ([401,404].includes(response.status)) setData(null); throw new Error(body.error); } setData(body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '操作尚未確認，請重試。'); }
    finally { lock.current = false; setBusy(false); }
  }
  const note = data?.note;
  return <div className={styles.stack}>{error && <section className={`study-card ${styles.stack}`}><p role="alert">{error}</p><button className="study-button" onClick={() => { setError(''); setReload(value => value + 1); }}>重新載入筆記</button></section>}
    {note ? <article className={`study-card ${styles.stack} ${styles.card}`}><NoteBadge note={note} /><h1 className={styles.title}>{note.title}</h1><p>{note.subject} → {note.chapter}</p><p className="study-muted">作者：{note.authorName} · 更新於 {noteDate(note.updatedAt)}</p>{note.type === 'community' && <p className="study-muted">此內容由使用者分享，未經 VetExam 官方審核。</p>}<div data-note-content className={styles.content}>{note.content}</div>
      <div className={styles.actions}>{note.canReact && (data.signedIn ? <><button className="study-button" disabled={busy} aria-pressed={note.isHelpful} onClick={() => void react('helpful')}>{note.isHelpful ? '已標記有幫助' : '有幫助'} {note.helpful}</button><button className="study-button" aria-label={note.isFavorite ? '★ 已收藏' : '☆ 收藏'} disabled={busy} aria-pressed={note.isFavorite} onClick={() => void react('favorite')}><StudyIcon name="heart" />{note.isFavorite ? '已收藏' : '收藏'}</button></> : <Link href="/login" className="study-button">登入以收藏或標記有幫助</Link>)}{note.canEdit && <Link href={`/notes/${id}/edit`} className="study-button">編輯筆記</Link>}</div>
    </article> : !error && <LoadingState label="載入筆記中…" />}
  </div>;
}
