'use client';
import Link from 'next/link';
import styles from './quiz.module.css';
export default function QuestionError({ reset }: { reset: () => void }) {
  return <main className={styles.page}><section className={styles.state}><h1>暫時無法載入題目</h1><p>請稍後再試。</p><div className={styles.actions}><button className="study-button" onClick={reset}>重新載入</button><Link href="/questions/search" className="study-button">題目搜尋</Link></div></section></main>;
}
