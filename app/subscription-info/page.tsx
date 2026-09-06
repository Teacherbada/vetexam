import Link from "next/link";
import PolicyPage, { PolicySection } from "@/components/policies/PolicyPage";
import styles from "@/components/policies/policies.module.css";
import { PRO_PLANS, money } from "@/app/subscription/plans";

const title = "訂閱與付款說明";
const subtitle = "了解 VetExam PRO 的方案、免費試用與自動續訂方式。";
export const metadata = { title: `VetExam｜${title}`, description: subtitle };

export default function SubscriptionInfoPage() {
  return <PolicyPage title={title} subtitle={subtitle}>
    <p className={styles.notice}>以下為 PRO 方案與服務規則說明。目前付款與好友推薦獎勵尚未開放；實際開放狀態請以<Link href="/subscription">會員方案頁</Link>公告為準。</p>
    <PolicySection title="PRO 目前提供內容"><p>VetExam PRO 目前包含：</p><ul>{["完整國考刷題", "弱點分析", "錯題本", "收藏題", "學習統計"].map(feature => <li key={feature}>{feature}</li>)}</ul></PolicySection>
    <PolicySection title="方案價格與試用後計費"><p>所有金額均為新台幣（NT$）。符合首次試用資格並完成綁卡後，各方案的計費方式如下：</p>
      <div className={styles.plans}>{PRO_PLANS.map(plan => <section className={styles.plan} key={plan.key}><h3>{plan.name}</h3><strong>{money(plan.price)} / {plan.period}</strong>{plan.originalPrice && <small>原價 <s>{money(plan.originalPrice)}</s></small>}<p>今天：NT$0</p><p>30 天免費試用結束後：{money(plan.price)} / {plan.period}，之後依此週期自動續訂。</p></section>)}</div>
    </PolicySection>
    <PolicySection title="30 天免費試用"><p>第一次訂閱 VetExam PRO 的使用者，必須先綁定有效信用卡作為付款方式，即可開始 30 天免費試用。免費試用期間不收取 PRO 訂閱費。</p><p>若使用者在免費試用結束前沒有取消，試用期結束後將依所選擇的方案自動續訂。</p><p>30 天免費試用原則上僅提供每個符合資格的帳號一次；取消後重新訂閱不會再次取得免費試用。</p></PolicySection>
    <PolicySection title="自動續訂"><p>VetExam PRO 為自動續訂服務。免費試用或目前訂閱期間結束前，若使用者沒有取消自動續訂，系統將依目前選擇的方案進行下一期扣款。</p></PolicySection>
    <PolicySection title="取消續訂"><p>使用者可以在下一個計費週期開始前取消自動續訂。取消後不會再收取下一期訂閱費用。目前已取得的 PRO 使用權，原則上仍可使用至目前有效期間結束。</p><p>正式取消方式將依網站當時提供的訂閱管理功能辦理。如需協助，也可以聯絡 VetExam 客服。詳細處理方式請參閱<Link href="/refund-policy">取消與退款政策</Link>。</p></PolicySection>
    <PolicySection title="好友推薦獎勵"><p>好友推薦獎勵尚未開放。開放後，當好友透過有效推薦完成註冊、綁定付款方式，並在 30 天免費試用結束後完成首次實際付款，推薦人即可獲得 1 個月免費 PRO 使用時間。</p><p><strong>推薦獎勵以被推薦人首次實際付款成功為觸發條件。</strong>僅註冊、綁卡或開始試用，尚不會取得獎勵。</p><p>推薦獎勵以延長 1 個月 PRO 使用期限的方式提供，適用月繳、半年與年度方案，不直接兌換為現金。</p></PolicySection>
  </PolicyPage>;
}
