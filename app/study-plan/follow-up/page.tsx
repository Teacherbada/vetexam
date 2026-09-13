import Link from 'next/link';
import FollowUp from './FollowUp';
import styles from '../study-plan.module.css';
import '../../home.css';
export const metadata = { title: '間隔複習追蹤 | VetExam' };
export default async function FollowUpPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  return <div className="study-home" lang="zh-Hant"><main className={styles.page}>
    <Link href="/study-plan" className="study-text-link">回國考教練</Link><h1>間隔複習追蹤</h1><FollowUp id={id} />
  </main></div>;
}
