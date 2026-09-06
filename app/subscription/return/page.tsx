import Link from "next/link";
import { headers } from "next/headers";
import { getUserSubscription } from "@/lib/subscription";
import { StudyIcon } from "@/components/dashboard/StudyUI";
import RefreshSubscription from "../RefreshSubscription";
import analysisStyles from "@/app/analysis/analysis.module.css";
import styles from "../subscription.module.css";

export const dynamic = "force-dynamic";
export default async function PaymentReturnPage() {
  let current: Awaited<ReturnType<typeof getUserSubscription>> = null;
  let failed = false;
  try { current = await getUserSubscription(await headers()); } catch { failed = true; }
  // No query parameter, Checkout URL or browser state can grant entitlement.
  return <main className={analysisStyles.page}><div className={styles.container}>
    <nav className={analysisStyles.breadcrumb} aria-label="麵包屑"><Link href="/" aria-label="回首頁"><StudyIcon name="home" />回首頁</Link><span>/</span><Link href="/subscription">會員方案</Link></nav>
    <section className={`study-card ${styles.card} ${styles.returnCard}`}>
      <h1 className="text-2xl font-semibold">確認會員狀態</h1>
      <p className={styles.description}>若你剛完成付款或綁定付款方式，我們正在等待付款平台確認。</p>
      <p role="status" className={styles.notice}>{failed ? "暫時無法讀取，請稍後重新整理。" : !current ? "請先登入查看你的會員狀態。" :
        current.access.hasProAccess ? "伺服器目前確認你具有 Pro 使用資格。詳細期間請查看會員方案。" : "目前尚未確認新的 Pro 使用資格，請稍後重新整理。"}</p>
      <div className={styles.billingActions}><RefreshSubscription /><Link href={current ? "/subscription" : "/login"} className="study-button">{current ? "查看會員方案" : "前往登入"}</Link></div>
    </section>
  </div></main>;
}
