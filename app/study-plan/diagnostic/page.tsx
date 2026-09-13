import Link from "next/link";
import { StudyIcon } from "@/components/dashboard/StudyUI";
import Diagnostic from "./Diagnostic";
import styles from "../study-plan.module.css";
import "../../home.css";

export const metadata = { title: "初始能力診斷 | VetExam" };
export default function DiagnosticPage() {
  return <div className="study-home" lang="zh-Hant"><main className={styles.page}>
    <Link href="/study-plan" className="study-text-link"><StudyIcon name="calendar" />回學習計畫</Link>
    <Diagnostic />
  </main></div>;
}
