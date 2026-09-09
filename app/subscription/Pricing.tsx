import Link from "next/link";
import BillingActions from "./BillingActions";
import { PRO_PLANS, money } from "./plans";
import styles from "./subscription.module.css";

export default function Pricing({ signedIn, managed, hasPro, enabled, expired, monthlyMatches }: {
  signedIn: boolean; managed: boolean; hasPro: boolean; enabled: boolean; expired: boolean; monthlyMatches: boolean;
}) {
  return <section aria-label="PRO 訂閱方案" className={styles.pricingGrid}>
    {PRO_PLANS.map(plan => <article key={plan.key} className={`${styles.priceCard} ${plan.key === "yearly" ? styles.recommended : ""}`}>
      <div className={styles.planHeading}><h2>{plan.name}</h2>{plan.key === "yearly" && <span className={styles.badge}>推薦方案</span>}</div>
      <p className={styles.planDescription}>{plan.description}</p>
      <p className={styles.planPrice}>{money(plan.price)}<small>/ {plan.period}</small></p>
      <div className={styles.savings}>{plan.originalPrice ? <><p>原價 <s>{money(plan.originalPrice)}</s><span>{plan.key === "half_year" ? "約省半個月費用" : `現省 ${money(plan.originalPrice - plan.price)}`}</span></p><p>約 {money(Math.round(plan.price / plan.months))} / 月</p></> : <p>按月續訂，依自己的步調安排。</p>}</div>
      <div className={styles.schedule}><strong>新會員享 30 天 PRO 免費體驗</strong><p>註冊即享，無需綁卡，到期不自動扣款。</p><p>自行訂閱付款後，每 {plan.months === 1 ? "月" : `${plan.months} 個月`} {money(plan.price)} 自動續訂</p></div>
      {plan.key !== "monthly" ? <button disabled className={styles.pendingButton}>訂閱 PRO · 即將開放</button>
        : !signedIn ? <Link href="/register" className={styles.trialButton}>註冊享 30 天 PRO</Link>
        : managed || hasPro ? <Link href="/subscription?view=account" className={styles.trialButton}>查看目前 PRO 方案</Link>
        : <BillingActions enabled={enabled && monthlyMatches} expired={expired} />}
      <p className={styles.paymentNote}>體驗結束後不會自動扣款。<br />如欲繼續使用 PRO，可自行選擇訂閱方案。</p>
      <p className={styles.availability}>{plan.key !== "monthly" || !enabled || !monthlyMatches ? "此方案目前尚未開放購買，不會產生扣款。" : !signedIn ? "新會員註冊即享免費體驗；購買方案請先登入。" : "訂閱將依付款頁顯示金額收費。"}</p>
    </article>)}
  </section>;
}
