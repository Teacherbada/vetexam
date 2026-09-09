import { StudyIcon } from "@/components/dashboard/StudyUI";
import styles from "./subscription.module.css";

export default function PlanInformation() {
  return <>
    <section className={styles.section} aria-labelledby="features-title">
      <h2 id="features-title">PRO 包含什麼？</h2>
      <p className={styles.sectionIntro}>每個方案，都包含以下完整學習功能。</p>
      <div className={styles.featureGrid}>{([
        ["book", "完整國考刷題", "解鎖 VetExam 完整國考題庫，不受免費方案限制。"],
        ["target", "弱點分析", "分析各科答題表現，找出目前最需要加強的科目。"],
        ["wrong", "錯題本", "集中整理曾經答錯的題目，方便重新練習。"],
        ["heart", "收藏題", "收藏重要或想再次複習的題目。"],
        ["chart", "學習統計", "追蹤答題量、正確率與學習進度。"],
      ] as const).map(([icon, heading, description]) => <article className={styles.featureCard} key={icon}><span className={styles.icon}><StudyIcon name={icon} /></span><h3>{heading}</h3><p>{description}</p></article>)}</div>
    </section>
    <section className={styles.referral} aria-labelledby="referral-title">
      <div><span className={styles.badge}>推薦獎勵 · 即將開放</span><h2 id="referral-title">邀請朋友，一起準備國考</h2>
      <p>好友透過你的邀請加入 VetExam，註冊並完成 30 天免費體驗，且首次實際付款成功後，推薦人可獲得獎勵。</p></div>
      <div><strong>1 個月免費 PRO</strong><p>統一延長 PRO 使用期限 1 個月，適用月繳、半年與年度方案；不折現、不依方案更換折扣。</p></div>
    </section>
    <section className={styles.section} aria-labelledby="trial-title">
      <h2 id="trial-title">30 天免費試用如何運作？</h2>
      <ol className={styles.steps}>{["註冊新帳號", "無需綁卡，免費使用 PRO 30 天", "到期回到 Free，不自動扣款", "自行選擇方案並付款，繼續使用 PRO"].map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol>
      <div className={styles.infoGrid}><article><h3>試用資格</h3><p>新會員註冊後自動獲得 30 天 PRO 免費體驗，無需綁定信用卡，體驗期內不收費，到期不會自動扣款。每個帳號只能享有一次 30 天免費試用，取消後重新訂閱不會再次取得試用。</p></article>
      <article><h3>自動續訂與取消</h3><p>免費體驗不會自動續訂。自行訂閱並完成付款後，付費方案才會自動續訂。你可以在下一個計費週期開始前取消自動續訂，取消後不會再收取下一期費用。目前已取得的 PRO 權限仍可使用至有效期限結束。</p><p>取消與退款規則請依 VetExam 最新訂閱與退款政策為準。</p></article></div>
    </section>
  </>;
}
