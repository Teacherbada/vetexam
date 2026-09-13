import Link from "next/link";
import { StudyIcon } from "@/components/dashboard/StudyUI";
import Diagnostic from "../diagnostic/Diagnostic";
import styles from "../study-plan.module.css";
import "../../home.css";

export const metadata = { title: "弱點確認與分析 | VetExam" };
export default function ConfirmationPage() {
  return <div className="study-home" lang="zh-Hant"><main className={styles.page}>
    <Link href="/study-plan/diagnostic" className="study-text-link"><StudyIcon name="chart" />回初始診斷</Link>
    <Diagnostic confirmation />
  </main></div>;
}
