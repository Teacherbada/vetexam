import Link from 'next/link';
import foundation from '@/components/ui/foundation.module.css';
import visual from './foundation-notes.module.css';
import PageHeader from '@/components/ui/PageHeader';

import NotesList from './NotesList';
import styles from './notes.module.css';
import '../home.css';
export const metadata = { title: '學習筆記 | VetExam' };
export default async function NotesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const key of ['subject','chapter','tab','sort','page']) if (typeof params[key] === 'string') query.set(key, params[key]);
  return <div className={`study-home ${foundation.foundation} ${visual.notes}`} lang="zh-Hant"><main className={styles.page}><Link href="/study-plan" className="study-text-link">回學習計畫</Link><PageHeader title="學習筆記" description="閱讀 VetExam 筆記，或分享你的章節重點。" /><NotesList key={query.toString()} query={query.toString()} /></main></div>;
}
