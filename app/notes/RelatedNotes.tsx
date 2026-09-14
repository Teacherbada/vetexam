"use client";
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { relatedNotesHref, type NoteView } from '@/lib/notes';
import styles from './notes.module.css';
export default function RelatedNotes({ subject, chapter }: { subject: string; chapter: string }) {
  const [notes, setNotes] = useState<NoteView[] | null>(null), [error, setError] = useState(false);
  useEffect(() => { const controller = new AbortController();
    Promise.all(['official','community'].map(async tab => {
      const response = await fetch(`/api/notes?${new URLSearchParams({ subject, chapter, tab, sort: 'helpful' })}`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(); return (await response.json()).notes.slice(0, 3) as NoteView[];
    })).then(groups => { if (!controller.signal.aborted) { setNotes(groups.flat()); setError(false); } }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [subject, chapter]);
  return <div className={styles.stack}>{error ? <p className="study-muted">相關筆記暫時無法載入，你仍可自行複習。</p> : notes === null ? <p role="status">載入相關筆記中…</p> : notes.length ? <>{(['official','community'] as const).map(type => <div key={type}><h3>{type === 'official' ? 'VetExam 官方筆記' : '社群熱門筆記'}</h3>{notes.some(note => note.type === type) ? <ul>{notes.filter(note => note.type === type).map(note => <li key={note.id}><Link href={`/notes/${note.id}`} className="study-text-link">{note.title}</Link> · 有幫助 {note.helpful}</li>)}</ul> : <p className="study-muted">目前尚無此類筆記。</p>}</div>)}</> : <p>目前這個章節還沒有可用的筆記。</p>}<Link href={relatedNotesHref(subject, chapter)} className="study-text-link">查看相關筆記</Link><p className="study-muted">也可以使用自己的課本或講義複習。閱讀筆記不會直接改變章節掌握狀態。</p></div>;
}
