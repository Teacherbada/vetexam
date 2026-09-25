import Link from 'next/link';
import type { NoteView } from '@/lib/notes';
import styles from './notes.module.css';
export function NoteBadge({ note }: { note: Pick<NoteView, 'type' | 'status' | 'visibility'> }) {
  return <div className={styles.actions}><span data-note-type={note.type} className={`${styles.badge} ${note.type === 'community' ? styles.community : ''}`}>{note.type === 'official' ? 'VetExam 筆記' : '社群筆記'}</span>{note.visibility === 'private' && <span>私人</span>}{note.status === 'draft' && <span>草稿</span>}{note.status === 'hidden' && <span>已隱藏</span>}</div>;
}
export function noteDate(value: string) { return new Intl.DateTimeFormat('zh-TW-u-ca-roc', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'Asia/Taipei' }).format(new Date(value)); }
export default function NoteCard({ note }: { note: NoteView }) {
  return <article className={`study-card ${styles.stack} ${styles.card}`}><NoteBadge note={note} /><h2><Link href={`/notes/${note.id}`} className="study-text-link">{note.title}</Link></h2><p className="study-muted">{note.subject} → {note.chapter}</p><p className={styles.content}>{note.content}</p><p className="study-muted">{note.authorName} · 更新於 {noteDate(note.updatedAt)} · 有幫助 {note.helpful}</p>{note.type === 'community' && <p className="study-muted">此內容由使用者分享。</p>}</article>;
}
