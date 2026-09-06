import Link from "next/link";
import { headers } from "next/headers";
import { StudyIcon } from "@/components/dashboard/StudyUI";
import { getUserSubscription } from "@/lib/subscription";
import type { SubscriptionStatus } from "@/lib/subscription-state";
import analysisStyles from "@/app/analysis/analysis.module.css";
import styles from "./subscription.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "會員方案 | VetExam" };

const labels: Record<SubscriptionStatus, string> = {
  free: "免費會員", trialing: "免費試用", active: "訂閱有效",
  past_due: "付款待處理", canceled: "已取消續訂", expired: "已到期",
};
function date(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "尚未設定";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

export default async function SubscriptionPage() {
  let result: Awaited<ReturnType<typeof getUserSubscription>> = null;
  let unavailable = false;
  try {
    result = await getUserSubscription(await headers());
  } catch {
    unavailable = true;
  }
  const access = result?.access;
  const subscription = result?.subscription;
  const title = access?.hasProAccess
    ? access.status === "trialing" ? "Pro 免費試用中" : "目前方案：VetExam Pro"
    : "目前方案：免費版";

  return <main className={analysisStyles.page}><div className={styles.container}>
    <nav className={analysisStyles.breadcrumb} aria-label="麵包屑">
      <Link href="/" aria-label="回首頁"><StudyIcon name="home" />回首頁</Link>
      <span aria-hidden="true">/</span><span aria-current="page">會員方案</span>
    </nav>
    <header className={analysisStyles.header}><div>
      <p className={analysisStyles.eyebrow}>陪你穩穩前進 · VETEXAM</p>
      <h1>會員方案與訂閱管理</h1><p>依照自己的步調，安排更完整的國考準備。</p>
    </div><span className={styles.icon}><StudyIcon name="leaf" /></span></header>
    <div className={styles.grid}>
      <section className={`study-card ${styles.card}`} aria-labelledby="current-plan">
        <p className={styles.eyebrow}>我的會員方案</p>
        {unavailable ? <div role="alert"><h2 id="current-plan">暫時無法讀取會員資料</h2>
          <p className={styles.description}>請稍後重新整理，確認你的最新會員狀態。</p>
          <a href="/subscription" className="study-button">重新整理</a></div>
          : !result ? <><h2 id="current-plan">登入後查看你的方案</h2>
            <p className={styles.description}>在這裡查看會員狀態、試用期間與 Pro 有效期限。</p>
            <Link href="/login" className="study-button study-button-primary">前往登入 <StudyIcon name="arrow" /></Link></>
          : access && <>
            <span className={styles.badge}>{labels[access.status]}</span>
            <h2 id="current-plan" className={styles.title}>{title}</h2>
            {access.status === "trialing" && access.hasProAccess && <p className={styles.notice}>試用剩餘 <strong>{access.trialDaysRemaining} 天</strong>，把握自己的學習節奏。</p>}
            {access.renewalCanceled && access.hasProAccess && <p className={styles.notice}>你的 Pro 已取消自動續訂，仍可使用至 {date(access.accessUntil)}。</p>}
            {access.status === "expired" && <p className={styles.description}>你的 Pro 期間已結束，目前可繼續使用免費功能。</p>}
            {access.status === "past_due" && <p className={styles.description}>付款狀態待處理，Pro 權限暫停。目前可繼續使用免費功能。</p>}
            {access.status === "canceled" && !access.hasProAccess && <p className={styles.description}>訂閱已取消，目前沒有有效的 Pro 使用期間。</p>}
            {access.status === "free" && <p className={styles.description}>從每天一點練習開始，慢慢累積自己的實力。</p>}
            {(access.status === "active" || access.status === "trialing") && !access.hasProAccess && <p className={styles.description}>目前尚無有效的 Pro 使用期間。若你認為狀態有誤，請聯絡我們。</p>}
            <dl className={styles.details}>
              <div><dt>目前會員狀態</dt><dd>{labels[access.status]}</dd></div>
              <div><dt>Pro 使用資格</dt><dd>{access.hasProAccess ? "可使用" : "未啟用"}</dd></div>
              {subscription?.trial_start && <div><dt>試用開始時間</dt><dd>{date(subscription.trial_start)}</dd></div>}
              {subscription?.trial_end && <div><dt>試用到期時間</dt><dd>{date(subscription.trial_end)}</dd></div>}
              {access.hasProAccess && access.status !== "trialing" && <div><dt>Pro 有效期限</dt><dd>{access.accessUntil ? date(access.accessUntil) : "既有授權 · 未設定到期日"}</dd></div>}
              {subscription?.current_period_end && !access.hasProAccess && <div><dt>最近一期結束時間</dt><dd>{date(subscription.current_period_end)}</dd></div>}
              <div><dt>下一次續訂</dt><dd>{access.renewalCanceled ? "已取消自動續訂" : access.nextRenewalAt ? date(access.nextRenewalAt) : "目前沒有排定續訂"}</dd></div>
            </dl>
            <p className={styles.small}>時間以台灣時間顯示。重新整理可查看最新狀態。</p>
            <a href="/subscription" className="study-button">重新整理狀態</a>
          </>}
      </section>
      <section className={`study-card ${styles.card} ${styles.pro}`} aria-labelledby="pro-plan">
        <div className={styles.proHeading}><span className={styles.icon}><StudyIcon name="paw" /></span><span className={styles.badge}>即將開放</span></div>
        <h2 id="pro-plan">VetExam Pro</h2><p className={styles.subtitle}>讓你的國考準備更完整</p>
        <p className={styles.description}>我們正在準備更完整的會員方案，陪你一步一步走向獸醫之路。</p>
        <ul className={styles.features}>
          <li><StudyIcon name="file" /><span>私人學習工具<small>方案內容即將公布</small></span></li>
          <li><StudyIcon name="calendar" /><span>月繳與年繳方案<small>即將推出</small></span></li>
          <li><StudyIcon name="leaf" /><span>Pro 免費試用<small>開放時間即將公布</small></span></li>
        </ul>
        <button type="button" disabled className={`study-button study-button-primary ${styles.upgrade}`}>升級 Pro · 即將開放</button>
        <p className={styles.small}>目前尚未開放購買，不會產生扣款。</p>
      </section>
    </div>
    <footer className={styles.footer}><span>每一點累積，都讓你離夢想更近。</span><Link href="/feedback">會員問題與建議 <StudyIcon name="arrow" /></Link></footer>
  </div></main>;
}
