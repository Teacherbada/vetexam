import Link from 'next/link';
import NoteDetail from '../NoteDetail';
import styles from '../notes.module.css';
import '../../home.css';
export const metadata = { title: '閱讀筆記 | VetExam' };
export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  return <div className="study-home" lang="zh-Hant"><main className={styles.page}><Link href="/notes" className="study-text-link">回學習筆記</Link><NoteDetail id={(await params).id} /></main></div>;
}
