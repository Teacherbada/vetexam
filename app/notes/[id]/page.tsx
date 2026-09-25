import Link from 'next/link';
import foundation from '@/components/ui/foundation.module.css';
import visual from '../foundation-notes.module.css';

import NoteDetail from '../NoteDetail';
import styles from '../notes.module.css';
import '../../home.css';
export const metadata = { title: '閱讀筆記 | VetExam' };
export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  return <div className={`study-home ${foundation.foundation} ${visual.notes} ${visual.detail}`} lang="zh-Hant"><main className={styles.page}><Link href="/notes" className="study-text-link">回學習筆記</Link><NoteDetail id={(await params).id} /></main></div>;
}
