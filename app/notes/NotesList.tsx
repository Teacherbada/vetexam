"use client";
import Link from 'next/link';
import { EmptyState, LoadingState } from '@/components/ui/ContentState';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { chapterGroups, EXAM_SUBJECTS } from '@/data/exam-chapters';
import type { NoteList } from '@/lib/notes';
import NoteCard from './NoteCard';
import styles from './notes.module.css';
export default function NotesList({ query }: { query: string }) {
  const router = useRouter(), params = new URLSearchParams(query);
  const [data, setData] = useState<NoteList | null>(null), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [pending, startTransition] = useTransition();
  useEffect(() => { const controller = new AbortController();
    fetch(`/api/notes?${query}`, { cache: 'no-store', signal: controller.signal }).then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error); if (!controller.signal.aborted) setData(body); }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [query, reload]);
  const tab = params.get('tab') ?? 'all', subject = params.get('subject') ?? '', chapter = params.get('chapter') ?? '';
  function href(patch: Record<string, string>) { const next = new URLSearchParams(query); next.delete('page'); for (const [key, value] of Object.entries(patch)) { if (value) next.set(key, value); else next.delete(key); } return `/notes?${next}`; }
  const newHref = `/notes/new?${new URLSearchParams({ subject, chapter })}`;
  return <div className={styles.stack}>
    <nav className={styles.actions} aria-label="筆記分類">{[['all','全部筆記'],['official','VetExam 精選'],['community','社群筆記'],['mine','我的筆記'],['favorites','收藏的筆記']].map(([value, label]) => <Link key={value} className="study-button" aria-current={tab === value ? 'page' : undefined} href={href({ tab: value })}>{label}</Link>)}</nav>
    <div className={styles.actions}>{data?.signedIn ? <Link href={newHref} className="study-button study-button-primary">新增筆記</Link> : <Link href="/login" className="study-button">登入以新增或收藏筆記</Link>}</div>
    <section className={`study-card ${styles.filters}`} aria-label="篩選筆記">
      <label className={styles.field}>科目<select aria-label="科目" disabled={pending} value={subject} onChange={event => startTransition(() => router.push(href({ subject: event.target.value, chapter: '' })))}><option value="">全部科目</option>{EXAM_SUBJECTS.map(value => <option key={value}>{value}</option>)}</select></label>
      <label className={styles.field}>章節<select aria-label="章節" value={chapter} disabled={pending || !subject} onChange={event => startTransition(() => router.push(href({ chapter: event.target.value })))}><option value="">全部章節</option>{chapterGroups(subject).flatMap(group => group.chapters).map(value => <option key={value}>{value}</option>)}</select></label>
      <label className={styles.field}>社群排序<select aria-label="社群排序" disabled={pending} value={params.get('sort') ?? 'latest'} onChange={event => startTransition(() => router.push(href({ sort: event.target.value })))}><option value="latest">最新</option><option value="helpful">最有幫助</option></select></label>
    </section>
    {error ? <section className={`study-card ${styles.stack}`}><p role="alert">{error}</p><button className="study-button" onClick={() => { setError(''); setReload(value => value + 1); }}>重新載入筆記</button></section> : !data ? <LoadingState label="載入筆記中…" /> : <>
      {data.notes.length ? data.notes.map(note => <NoteCard key={note.id} note={note} />) : <EmptyState title={tab === 'favorites' ? '還沒有可閱讀的收藏筆記。' : tab === 'mine' ? '你還沒有筆記。' : '目前這個範圍還沒有可用的筆記。'}>{data.signedIn && <Link href={newHref} className="study-button">分享第一篇筆記</Link>}</EmptyState>}
      <div className={styles.actions}>{data.page > 1 && <Link href={href({ page: String(data.page - 1) })} className="study-button">上一頁</Link>}<span>第 {data.page} 頁</span>{data.hasMore && <Link href={href({ page: String(data.page + 1) })} className="study-button">下一頁</Link>}</div>
    </>}
  </div>;
}
