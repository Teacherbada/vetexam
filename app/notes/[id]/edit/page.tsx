import Link from 'next/link';
import NoteEditor from '../../NoteEditor';
import styles from '../../notes.module.css';
import '../../../home.css';
export const metadata = { title: '編輯筆記 | VetExam' };
export default async function EditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <div className="study-home" lang="zh-Hant"><main className={styles.page}><Link href={`/notes/${encodeURIComponent(id)}`} className="study-text-link">回筆記</Link><h1>編輯筆記</h1><NoteEditor id={id} /></main></div>;
}
