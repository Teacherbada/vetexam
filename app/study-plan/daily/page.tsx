import Link from 'next/link';
import DailyTask from './DailyTask';
import styles from '../study-plan.module.css';
import '../../home.css';
export const metadata={title:'今日國考教練任務 | VetExam'};
export default function DailyPage() {
  return <div className="study-home" lang="zh-Hant"><main className={styles.page}><Link href="/study-plan" className="study-text-link">回國考教練</Link><h1>今日學習</h1><DailyTask /></main></div>;
}
