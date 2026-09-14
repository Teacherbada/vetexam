import Link from 'next/link';
import CustomPlan from './CustomPlan';
import styles from '../study-plan.module.css';
import '../../home.css';
export const metadata = { title: '自訂學習進度 | VetExam' };
export default function CustomPage() {
  return <div className="study-home" lang="zh-Hant"><main className={styles.page}><Link href="/study-plan" className="study-text-link">回學習計畫</Link><h1>自訂學習進度</h1><CustomPlan /></main></div>;
}
