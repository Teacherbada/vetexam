import Link from "next/link";
import { StudyIcon } from "@/components/dashboard/StudyUI";
import ModeSelector from "./ModeSelector";
import styles from "./study-plan.module.css";
import "../home.css";

export const metadata = { title: "學習計畫 | VetExam" };

export default function StudyPlanPage() {
  return <div className="study-home" lang="zh-Hant">
    <main className={styles.page}>
      <Link href="/" className="study-text-link"><StudyIcon name="home" />回首頁</Link>
      <header className={styles.intro}>
        <h1>學習計畫</h1>
        <p>選擇適合你的準備方式，一步一步靠近目標。</p>
      </header>
      <ModeSelector />
    </main>
  </div>;
}
