import Link from 'next/link';
import NoteEditor from '../NoteEditor';
import styles from '../notes.module.css';
import '../../home.css';
export const metadata = { title: '新增筆記 | VetExam' };
export default async function NewNotePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <div className="study-home" lang="zh-Hant"><main className={styles.page}><Link href="/notes" className="study-text-link">回學習筆記</Link><h1>新增筆記</h1><NoteEditor subject={typeof params.subject === 'string' ? params.subject : ''} chapter={typeof params.chapter === 'string' ? params.chapter : ''} /></main></div>;
}
