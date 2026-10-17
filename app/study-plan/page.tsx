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
      <PageHeader title="學習計畫 · 國考教練" description="知道今天練什麼、為什麼練，以及完成後的下一步。" />
      <ModeSelector />
    </main>
  </div>;
}
