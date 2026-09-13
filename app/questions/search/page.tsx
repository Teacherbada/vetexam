import Link from 'next/link';
import { parseSearch, searchUrl, type SearchParams } from '@/lib/question-search';
import SubjectChapterFields from './SubjectChapterFields';
import { searchPublicQuestions } from '@/lib/public-questions';
import { formatExamYear } from '@/lib/exam-year';
import styles from '../quiz.module.css';
import searchStyles from './search.module.css';

export const metadata = { title: '題目搜尋｜VetExam', description: '依關鍵字、科目、年份與題號搜尋獸醫師國考題。', robots: { index: false, follow: true } };
export default async function SearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filters = parseSearch(await searchParams);
  const result = await searchPublicQuestions(filters);
  return <main className={styles.page}><div className={styles.container}>
    <nav className={searchStyles.actions} aria-label="導覽"><Link href="/" className="study-button">首頁</Link><Link href="/subjects" className="study-button">開始刷題</Link></nav>
    <section className={styles.card}><h1 className={searchStyles.title}>題目搜尋</h1><p>搜尋歷屆國考題，找到想釐清的觀念。</p>
      <form action="/questions/search" className={searchStyles.form} key={searchUrl(filters)}>
        <label className={searchStyles.keyword}>關鍵字<input type="search" name="q" defaultValue={filters.q} maxLength={200} placeholder="例如 Addison、腎上腺、FIP" /></label>
        <SubjectChapterFields subject={filters.subject} chapter={filters.chapter} />
        <label>國考年份<input name="year" type="number" min="1" max="9999" defaultValue={filters.year ?? ''} placeholder="例如 115" /></label>
        <label>題號<input name="number" type="number" min="1" max="2147483647" defaultValue={filters.number ?? ''} placeholder="例如 37" /></label>
        {filters.set && <input type="hidden" name="set" value={filters.set} />}
        <div className={searchStyles.actions}><button className="study-button study-button-primary" type="submit">搜尋題目</button><Link href="/questions/search" className="study-button">清除條件</Link></div>
      </form>
    </section>
    <section aria-label="搜尋結果" className={searchStyles.results}>
      {filters.invalid ? <p role="status">請確認科目、章節、年份與題號格式。</p> : !filters.active ? <p>輸入關鍵字，或選擇科目、年份開始搜尋。</p> : !result.rows.length ? <p role="status">找不到符合條件的題目。請調整章節、年份或改用較短關鍵字。</p> : result.rows.map(row => <article className={styles.card} key={row.id}>
        <h2 className={styles.meta}>{formatExamYear(row.exam_year)}｜{row.subject}｜第 {row.question_number} 題</h2>
        <p className={searchStyles.summary}>{row.summary}</p><Link href={`/questions/${row.id}`} className="study-button">查看題目</Link>
      </article>)}
    </section>
    {filters.active && !filters.invalid && <nav className={searchStyles.actions} aria-label="搜尋結果分頁">{filters.page > 1 && <Link href={searchUrl(filters, filters.page - 1)} className="study-button">上一頁</Link>}<span>第 {filters.page} 頁</span>{result.hasNext && <Link href={searchUrl(filters, filters.page + 1)} className="study-button">下一頁</Link>}</nav>}
  </div></main>;
}
