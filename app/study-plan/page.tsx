import PageHeader from "@/components/ui/PageHeader";
import foundation from "@/components/ui/foundation.module.css";
import Link from "next/link";
import { StudyIcon } from "@/components/dashboard/StudyUI";
import ModeSelector from "./ModeSelector";
import styles from "./foundation-study-plan.module.css";

export const metadata = { title: "學習計畫 | VetExam" };

export default function StudyPlanPage() {
  return <div className={styles.background} lang="zh-Hant">
    <main className={`${foundation.foundation} ${styles.page}`}>
      <Link href="/" className="study-text-link"><StudyIcon name="home" />回首頁</Link>
      <PageHeader title="學習計畫" description="選擇適合你的準備方式，一步一步靠近目標。" />
      <ModeSelector />
    </main>
  </div>;
}
