import Link from "next/link";
import { StudyIcon } from "@/components/dashboard/StudyUI";
import analysis from "@/app/analysis/analysis.module.css";
import shared from "./subscription.module.css";
import styles from "./account.module.css";

export default function LoadingSubscription() {
  return <main className={analysis.page}><div className={shared.container}>
    <nav className={analysis.breadcrumb} aria-label="麵包屑"><Link href="/" aria-label="回首頁"><StudyIcon name="home" />回首頁</Link></nav>
    <section className={`study-card ${shared.card} ${shared.returnCard}`} aria-busy="true" aria-label="正在讀取方案資訊">
      <p role="status">正在讀取方案資訊…</p>
      <div aria-hidden="true"><div className={`${styles.skeleton} ${styles.skeletonTitle}`} /><div className={styles.skeleton} /><div className={styles.skeleton} /></div>
    </section>
  </div></main>;
}
