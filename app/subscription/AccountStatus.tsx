import Link from "next/link";
import type { getUserSubscription } from "@/lib/subscription";
import type { getBillingView } from "@/lib/payment/view";
import type { SubscriptionStatus } from "@/lib/subscription-state";
import BillingActions from "./BillingActions";
import RefreshSubscription from "./RefreshSubscription";
import styles from "./account.module.css";
import shared from "./subscription.module.css";

type Member = NonNullable<Awaited<ReturnType<typeof getUserSubscription>>>;
type Billing = Awaited<ReturnType<typeof getBillingView>>;
const labels: Record<SubscriptionStatus, string> = {
  free: "免費方案", trialing: "免費試用中", active: "訂閱有效",
  canceled: "已取消自動續訂", expired: "PRO 已到期", past_due: "付款未完成",
};

export function subscriptionDate(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "尚未提供";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

export default function AccountStatus({ member, billing, unavailable = false }: {
  member: Member | null; billing: Billing | null; unavailable?: boolean;
}) {
  if (unavailable) return <section className={`study-card ${shared.card}`} role="alert"><h2>目前無法取得方案資訊</h2><p className={shared.description}>請稍後再試一次。暫時無法確認會員狀態。</p><RefreshSubscription /></section>;
  if (!member) return <section className={`study-card ${shared.card}`}><h2>登入後查看你的方案</h2><p className={shared.description}>登入後即可查看個人的 PRO 資格、有效期限與續訂狀態。</p><Link href="/login" className="study-button study-button-primary">前往登入</Link></section>;

  const { access, subscription } = member;
  const trial = access.status === "trialing" && access.hasProAccess;
  const nextPayment = access.nextRenewalAt && Number.isFinite(Date.parse(access.nextRenewalAt)) ? access.nextRenewalAt : null;
  const renewal = access.renewalCanceled ? "已取消自動續訂" : nextPayment ? "已開啟" : access.status === "free" || access.status === "expired" ? "目前沒有排定續訂" : "尚未提供續訂資訊";
  return <div className={styles.content}>
    <section className={`study-card ${shared.card}`} aria-labelledby="current-plan">
      <div className={styles.heading}><div><p className={shared.eyebrow}>目前方案</p><h2 id="current-plan" className={styles.planName}>{access.hasProAccess ? "VetExam PRO" : "VetExam Free"}</h2></div><span className={shared.badge}>{access.renewalCanceled && access.hasProAccess ? "已取消自動續訂" : labels[access.status]}</span></div>
      {access.status === "free" && <p className={shared.description}>你目前使用免費方案。</p>}
      {trial && <div className={shared.notice}><strong>免費試用中 · 還有 {access.trialDaysRemaining} 天</strong><p>試用結束：{subscriptionDate(subscription?.trial_end)}</p></div>}
      {access.renewalCanceled && access.hasProAccess && <p className={shared.notice}>你仍可使用 PRO 至：{subscriptionDate(access.accessUntil)}。到期後將不再自動扣款。</p>}
      {access.status === "expired" && <p className={shared.description}>VetExam PRO 已到期，目前方案為 Free，可繼續使用免費功能。</p>}
      {access.status === "past_due" && <p className={styles.warning}>目前未能完成最新一期付款，PRO 權限暫停。請透過訂閱管理更新付款方式或聯絡客服。</p>}
      {access.status === "canceled" && !access.hasProAccess && <p className={shared.description}>訂閱已取消，目前沒有有效的 PRO 使用期間。</p>}
      {(access.status === "active" || access.status === "trialing") && !access.hasProAccess && <p className={styles.warning}>目前尚無有效的 PRO 使用期間。若你認為狀態有誤，請聯絡客服確認。</p>}
      <dl className={shared.details}>
        <div><dt>PRO 使用資格</dt><dd>{access.hasProAccess ? "可使用" : "未啟用"}</dd></div>
        {access.hasProAccess && <div><dt>方案週期</dt><dd>尚未提供個人方案週期</dd></div>}
        {subscription?.current_period_start && <div><dt>本期開始時間</dt><dd>{subscriptionDate(subscription.current_period_start)}</dd></div>}
        {subscription?.trial_start && <div><dt>試用開始時間</dt><dd>{subscriptionDate(subscription.trial_start)}</dd></div>}
        {subscription?.trial_end && <div><dt>試用結束日期</dt><dd>{subscriptionDate(subscription.trial_end)}</dd></div>}
        {access.hasProAccess && <div><dt>目前 PRO 有效期限</dt><dd>{access.accessUntil ? subscriptionDate(access.accessUntil) : "既有授權 · 未設定到期日"}</dd></div>}
        {!access.hasProAccess && (subscription?.current_period_end || subscription?.expires_at) && <div><dt>最近一期結束時間</dt><dd>{subscriptionDate(subscription?.current_period_end ?? subscription?.expires_at)}</dd></div>}
      </dl>
      <div className={styles.actions}><Link href="/subscription" className="study-button">查看 PRO 方案</Link><RefreshSubscription /></div>
      <p className={shared.small}>時間以台灣時間顯示。會員狀態以伺服器最新資料為準。</p>
    </section>
    <div className={styles.grid}>
      <section className={`study-card ${shared.card}`} aria-labelledby="renewal-heading"><h2 id="renewal-heading">自動續訂</h2><p className={styles.status}>{renewal}</p>
        <dl className={shared.details}><div><dt>{trial ? "預計首次扣款" : "下次預計付款"}</dt><dd>{access.renewalCanceled ? "已取消未來續訂扣款" : nextPayment ? subscriptionDate(nextPayment) : "尚未提供"}</dd></div></dl>
        {!access.renewalCanceled && <p className={shared.description}>{trial ? "試用後的方案與金額尚未提供。" : "下一期方案與金額尚未提供。"}{!nextPayment && "下一期扣款資訊將於付款系統完成後顯示。"}</p>}
        {trial && !access.renewalCanceled && <p className={shared.description}>如果不希望試用結束後自動續訂，請在下一個計費週期開始前取消自動續訂。</p>}
        {billing?.managed ? <BillingActions enabled={billing.enabled} managed canceled={access.renewalCanceled} canResume={billing.canResume} expired={access.status === "expired"} /> : <><button className="study-button" disabled>管理自動續訂 · 尚未開放</button><p className={shared.small}>{billing === null ? "暫時無法取得付款管理資訊，請稍後重試或聯絡客服。" : "目前沒有可由付款平台管理的訂閱。如需協助，請聯絡客服。"}</p></>}
        <p className={shared.description}>取消續訂會停止未來扣款，目前 PRO 仍可使用至有效期限。取消續訂不等於退款。</p><Link className={styles.textLink} href="/refund-policy">取消與退款政策</Link>
      </section>
      <section className={`study-card ${shared.card}`} aria-labelledby="reward-heading"><h2 id="reward-heading">好友推薦</h2><span className={shared.badge}>即將開放</span><p className={styles.status}>推薦獎勵尚未提供</p><p className={shared.description}>邀請好友加入 VetExam。好友完成首次實際付款成功後，你可以獲得 1 個月免費 PRO 使用時間。</p><p className={shared.description}>獎勵以延長 PRO 使用期限提供。目前尚無可顯示的個人獎勵明細或延長紀錄。</p><Link className={styles.textLink} href="/subscription-info">訂閱與付款說明</Link></section>
    </div>
  </div>;
}
