import Link from "next/link";
import BillingActions from "./BillingActions";
import { PRO_PLANS, money } from "./plans";
import styles from "./subscription.module.css";

export default function Pricing({ signedIn, managed, hasPro, enabled, trialEligible, expired, monthlyMatches }: {
  signedIn: boolean; managed: boolean; hasPro: boolean; enabled: boolean; trialEligible: boolean; expired: boolean; monthlyMatches: boolean;
}) {
  return <section aria-label="PRO 訂閱方案" className={styles.pricingGrid}>
    {PRO_PLANS.map(plan => <article key={plan.key} className={`${styles.priceCard} ${plan.key === "yearly" ? styles.recommended : ""}`}>
      <div className={styles.planHeading}><h2>{plan.name}</h2>{plan.key === "yearly" && <span className={styles.badge}>推薦方案</span>}</div>
      <p className={styles.planDescription}>{plan.description}</p>
      <p className={styles.planPrice}>{money(plan.price)}<small>/ {plan.period}</small></p>
      <div className={styles.savings}>{plan.originalPrice ? <><p>原價 <s>{money(plan.originalPrice)}</s><span>{plan.key === "half_year" ? "約省半個月費用" : `現省 ${money(plan.originalPrice - plan.price)}`}</span></p><p>約 {money(Math.round(plan.price / plan.months))} / 月</p></> : <p>按月續訂，依自己的步調安排。</p>}</div>
      <div className={styles.schedule}><strong>30 天免費試用</strong><p>今天 NT$0 · 30 天後 {money(plan.price)} / {plan.period}</p><p>之後每 {plan.months === 1 ? "月" : `${plan.months} 個月`} {money(plan.price)} 自動續訂</p></div>
      {plan.key !== "monthly" ? <button disabled className={styles.pendingButton}>開始 30 天免費試用 · 即將開放</button>
        : !signedIn ? <Link href="/login" className={styles.trialButton}>開始 30 天免費試用</Link>
        : managed || hasPro ? <a href="#current-plan" className={styles.trialButton}>查看目前 PRO 方案</a>
        : <BillingActions enabled={enabled && monthlyMatches} trialEligible={trialEligible} expired={expired} />}
      <p className={styles.paymentNote}>需先綁定有效信用卡。<br />30 天內取消不會收取下一期訂閱費。</p>
      <p className={styles.availability}>{plan.key !== "monthly" || !enabled || !monthlyMatches ? "此方案目前尚未開放購買，不會產生扣款。" : !signedIn ? "請先登入確認試用資格。" : !trialEligible ? "你的帳號不適用首次免費試用；訂閱將依付款頁顯示金額收費。" : "試用僅適用符合資格的首次訂閱帳號。"}</p>
    </article>)}
  </section>;
}
