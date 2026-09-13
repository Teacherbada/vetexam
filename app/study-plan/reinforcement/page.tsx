import Link from "next/link";
import { StudyIcon } from "@/components/dashboard/StudyUI";
import Reinforcement from "./Reinforcement";
import styles from "../study-plan.module.css";
import "../../home.css";

export const metadata = { title: "補強任務與確認 | VetExam" };
export default function ReinforcementPage() {
  return <div className="study-home" lang="zh-Hant"><main className={styles.page}>
    <Link href="/study-plan" className="study-text-link"><StudyIcon name="target" />回國考教練</Link>
    <h1>補強任務</h1>
    <Reinforcement />
  </main></div>;
}
