import { learningTrends, TREND_MIN_QUESTIONS } from '@/lib/learning-trends';
import type { History } from '@/lib/learning-client';
import styles from './foundation-analysis.module.css';
export default function Trends({ history }: { history: History[] }) {
  const trend = learningTrends(history);
  const percent = (value: number | null) => value === null ? '近期資料不足' : `${Math.round(value)}%`;
  return <section className={styles.subjectSection} aria-labelledby="trends-title">
    <div className={styles.sectionHeader}><h2 id="trends-title">近期學習趨勢</h2><p>同一期間每題取最後一次作答，至少 {TREND_MIN_QUESTIONS} 題才比較</p></div>
    <div className={styles.trendGrid}>{([['最近 7 天',trend.recent],['前 7 天',trend.previous],['最近 30 天',trend.month],['累積練習',trend.all]] as const).map(([label, row]) => <article className={styles.subjectCard} key={label}><h3>{label}</h3><strong>{percent(row.accuracy)}</strong><p>{row.count} 題</p></article>)}</div>
    <p className={styles.notice}>最近 7 天相較前 7 天：{trend.change === null ? '近期資料不足' : `${trend.change >= 0 ? '+' : ''}${Math.round(trend.change)} 個百分點`}</p>
    <div className={styles.trendGrid}>{trend.subjects.map(row => <article className={styles.subjectCard} key={row.subject}><h3>{row.subject}</h3><p>{row.change === null ? '近期資料不足' : `${percent(row.previous.accuracy)} → ${percent(row.recent.accuracy)}`}</p><small>前期 {row.previous.count} 題 · 最近 {row.recent.count} 題</small></article>)}</div>
    <p className={styles.description}>以現在往前計算 7／30 天；只使用有作答時間的個人歷程。累積練習採每題最後一次作答，與上方首次作答掌握度的用途不同。舊裝置摘要不納入。</p>
  </section>;
}
