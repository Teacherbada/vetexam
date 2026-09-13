import Link from 'next/link';
import styles from '../quiz.module.css';
export default function NotFound() {
  return <main className={styles.page}><section className={styles.state}><h1>找不到題目</h1><p>這道公開題目不存在或已無法使用。</p><Link href="/questions/search" className="study-button">回到題目搜尋</Link></section></main>;
}
