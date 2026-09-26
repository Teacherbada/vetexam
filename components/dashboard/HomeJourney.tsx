import Link from 'next/link';
import { StudyIcon, type StudyIconName } from './StudyUI';
import styles from '@/app/home-foundation.module.css';

const steps: { title: string; description: string; icon: StudyIconName }[] = [
  { title: '刷題', description: '從歷屆獸醫師國考題開始練習。', icon: 'book' },
  { title: '找弱點', description: '從科目與章節表現，找到下一個練習方向。', icon: 'target' },
  { title: '安排複習', description: '利用既有弱點補強與記憶排程，安排適合再次練習的題目。', icon: 'calendar' },
  { title: '持續追蹤', description: '透過學習紀錄、正確率與近期趨勢看見自己的進步。', icon: 'chart' },
];

export default function HomeJourney() {
  return <section className={styles.journey} aria-labelledby="home-journey-title" data-home-reveal>
    <header><p className={styles.kicker}>從練習到複習，一步一步準備</p><h2 id="home-journey-title">VetExam 怎麼陪你準備國考？</h2></header>
    <ol className={styles.steps}>{steps.map((step, index) => <li key={step.title} data-home-step>
      <div className={styles.stepHeading}><span className={styles.stepNumber}>{String(index + 1).padStart(2, '0')}</span><StudyIcon name={step.icon} /></div>
      <h3>{step.title}</h3><p>{step.description}</p>{index < steps.length - 1 && <span className={styles.stepArrow} aria-hidden="true"><StudyIcon name="arrow" /></span>}
    </li>)}</ol>
    <div className={styles.positioning}>
      <p>累積作答紀錄後，到學習計畫查看適合你的任務與複習。</p>
      <Link href="/study-plan" className="study-text-link">前往學習計畫<StudyIcon name="arrow" /></Link>
    </div>
  </section>;
}
